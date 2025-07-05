// sensorController.js

const axios = require("axios");
const WebSocket = require("ws");
const { performance } = require("perf_hooks");
const mqtt = require("mqtt");
const logger = require("../config/logger");

const {
  CncSensor,
  LaserSensor,
  PrintingSensor,
} = require("../models/sensorModel");
const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
const {
  getWebSocketServer,
  broadcastCurrent,
} = require("../config/websocketServer");

const getModelByType = (type, context) => {
  // console.log(`Type: ${type}, Context: ${context}`);

  const normalizedType = type.toLowerCase().trim();

  if (context === "peminjaman") {
    switch (normalizedType) {
      case "cnc":
      case "cnc milling":
      case "milling":
        return Cnc;
      case "laser":
      case "laser cutting":
      case "lasercutting":
        return Laser;
      case "printing":
      case "3d printing":
      case "3dprinting":
        return Printing;
      default:
        throw new Error(`Invalid type for peminjaman: ${type}`);
    }
  } else if (context === "sensor") {
    switch (normalizedType) {
      case "cnc":
      case "cnc milling":
      case "milling":
        return CncSensor;
      case "laser":
      case "laser cutting":
      case "lasercutting":
        return LaserSensor;
      case "printing":
      case "3d printing":
      case "3dprinting":
        return PrintingSensor;
      default:
        throw new Error(`Invalid type for sensor: ${type}`);
    }
  } else {
    throw new Error(`Invalid context: ${context}`);
  }
};

function logWithTimestamp(message, data = null) {
  const now = new Date(); // Current date and time
  const preciseTime = performance.now(); // High-precision timestamp

  const formattedDate = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const formattedTime = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Add milliseconds from performance.now()
  const milliseconds = String(Math.floor(preciseTime % 1000)).padStart(3, "0");
  const fullTimestamp = `${formattedDate}, ${formattedTime}.${milliseconds}`;

  if (data) {
    console.log(`[${fullTimestamp}] : ${message}`, data);
    logger.info(`${message} ${JSON.stringify(data)}`);
  } else {
    console.log(`[${fullTimestamp}] : ${message}`);
    logger.info(message);
  }
}

function convertTimeStringToDate(timeString, baseDate) {
  if (!timeString || !baseDate) {
    console.error("ERROR: Invalid timeString or baseDate provided");
    return null;
  }

  logWithTimestamp(
    `Converting time string: ${timeString} with date: ${baseDate}`
  );

  try {
    if (timeString.includes("T")) {
      const dateFromISO = new Date(timeString);
      if (!isNaN(dateFromISO.getTime())) {
        return dateFromISO;
      } else {
        console.error("ERROR: Invalid ISO format time string.");
        return null;
      }
    }

    // Parse the time components
    const timeMatch = timeString
      .toLowerCase()
      .match(/^(\d{1,2}):(\d{2}):?(\d{2})?\s*(am|pm)$/);
    if (!timeMatch) {
      console.error(`Invalid time format: ${timeString}`);
      return null;
    }

    let [_, hours, minutes, seconds, period] = timeMatch;
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes, 10);

    // Validate hours and minutes
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
      console.error(`Invalid hours/minutes: ${hours}:${minutes}`);
      return null;
    }

    // Convert to 24-hour format
    if (period === "pm" && hours < 12) {
      hours += 12;
    } else if (period === "am" && hours === 12) {
      hours = 0;
    }

    // Create new date object using the base date
    const date = new Date(baseDate);
    date.setHours(hours, minutes, 0, 0);

    logWithTimestamp(`Converted date: ${date.toISOString()}`);

    logWithTimestamp(
      `Converted time components - Hours: ${hours}, Minutes: ${minutes}`
    );
    logWithTimestamp(`Final converted date: ${date.toISOString()}`);

    return date;
  } catch (error) {
    console.error(`ERROR: Failed to convert timeString to Date: ${error}`);
    return null;
  }
}

let wss = null;

function initializeWebSocket(websocketServer) {
  wss = websocketServer;
  console.log("[WebSocket] Initialized in sensorController");
}

const startRental = async (req, res) => {
  logger.info("Aktivasi memulai peminjaman diterima");
  logWithTimestamp("startRental diterima");
  const { peminjamanId, type } = req.body;
  logWithTimestamp(`Received peminjamanId: ${peminjamanId}, type: ${type}`);
  logger.info(`Received peminjamanId: ${peminjamanId}, type: ${type}`);

  if (!peminjamanId || !type) {
    logger.error("peminjamanId dan type tidak disediakan");
    return res
      .status(400)
      .json({ message: "peminjamanId dan type harus disediakan." });
  }

  try {
    const Model = getModelByType(type, "peminjaman");

    // Tambahkan validasi untuk memastikan Model ada
    if (!Model) {
      logWithTimestamp("Error: Invalid peminjaman type");
      return res.status(400).json({ message: "Tipe peminjaman tidak valid." });
    }

    let peminjaman = await Model.findById(peminjamanId);

    if (!peminjaman) {
      return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
    }

    if (peminjaman.isStarted) {
      console.log("Error: Peminjaman sudah dimulai.");
      return res.status(400).json({ message: "Peminjaman sudah dimulai." });
    }

    const alamatEsp = peminjaman.alamat_esp;
    const baseDate = new Date(peminjaman.tanggal_peminjaman);

    logWithTimestamp(
      `Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`
    );

    const awalPeminjamanDate = convertTimeStringToDate(
      peminjaman.awal_peminjaman,
      baseDate
    );
    let akhirPeminjamanDate = convertTimeStringToDate(
      peminjaman.akhir_peminjaman,
      baseDate
    );

    const now = new Date();

    console.log(`awalPeminjamanDate: ${awalPeminjamanDate}`);
    console.log(`akhirPeminjamanDate: ${akhirPeminjamanDate}`);
    console.log(`Is now < awalPeminjamanDate?`, now < awalPeminjamanDate);
    console.log(`Is now > akhirPeminjamanDate?`, now > akhirPeminjamanDate);

    if (!awalPeminjamanDate || !akhirPeminjamanDate) {
      console.error("Invalid waktu peminjaman format detected");
      return res
        .status(400)
        .json({ message: "Invalid waktu peminjaman format." });
    }

    if (now < awalPeminjamanDate) {
      console.log(
        `Waktu sekarang (${now}) belum mencapai waktu awal peminjaman (${awalPeminjamanDate}).`
      );
      return res
        .status(400)
        .json({ message: "Waktu peminjaman belum dimulai." });
    }

    if (now > akhirPeminjamanDate) {
      peminjaman.isStarted = false;
      await peminjaman.save();
      return res
        .status(400)
        .json({ message: "Waktu peminjaman sudah berakhir." });
    }

    try {
      // Nyalakan relay
      // Nyalakan relay saja, tanpa buzzer
      const relayResponse = await axios.post(alamatEsp, {
        button: true,
        buzzer: false, // Pastikan buzzer mati saat awal peminjaman
      });

      logWithTimestamp(`Relay response: ${relayResponse.status}`);

      if (relayResponse.status === 201) {
        peminjaman.isStarted = true;
        peminjaman.isActivated = true;
        peminjaman.activatedAt = new Date();
        await peminjaman.save();

        const SensorModel = getModelByType(type, "sensor");
        // Reset buzzer status
        await SensorModel.updateOne(
          {},
          {
            $set: {
              buzzerStatus: false,
              lastBuzzerActivation: null,
            },
          }
        );

        let buzzerActivated = false;

        const monitorInterval = setInterval(async () => {
          try {
            const now = new Date();
            const endTime = new Date(akhirPeminjamanDate);
            const timeLeft = endTime - now;

            // Jika waktu sudah habis atau peminjaman tidak aktif
            if (timeLeft <= 0 || !peminjaman.isStarted) {
              clearInterval(monitorInterval);
              try {
                await axios.post(alamatEsp, {
                  button: false,
                  buzzer: false,
                });

                await SensorModel.updateOne(
                  {},
                  {
                    $set: {
                      buzzerStatus: false,
                      lastBuzzerActivation: null,
                    },
                  }
                );
              } catch (error) {
                console.error("Error mematikan perangkat:", error);
              }
              return;
            }

            // Aktifkan buzzer hanya jika:
            // 1. Waktu tersisa <= 5 menit
            // 2. Buzzer belum diaktifkan
            // 3. Peminjaman masih aktif
            if (
              timeLeft <= 5 * 60 * 1000 &&
              !buzzerActivated &&
              peminjaman.isStarted
            ) {
              try {
                logWithTimestamp(
                  `Menyalakan buzzer warning untuk peminjaman: ${peminjamanId}`
                );

                // Update status buzzer di database
                await SensorModel.updateOne(
                  {},
                  {
                    $set: {
                      buzzerStatus: true,
                      lastBuzzerActivation: now,
                    },
                  }
                );

                // Nyalakan buzzer
                await axios.post(alamatEsp, {
                  button: true, // Relay tetap menyala
                  buzzer: true,
                });

                buzzerActivated = true;
                logWithTimestamp(`Buzzer aktif for rental ${peminjamanId}`);
                logger.info(`Buzzer aktif for rental ${peminjamanId}`);

                // Matikan buzzer setelah 30 detik
                setTimeout(async () => {
                  try {
                    await axios.post(alamatEsp, {
                      button: true, // Relay tetap menyala
                      buzzer: false,
                    });

                    await SensorModel.updateOne(
                      {},
                      {
                        $set: {
                          buzzerStatus: false,
                          lastBuzzerActivation: now,
                        },
                      }
                    );

                    logger.info(
                      `Buzzer dimatikan untuk peminjaman ${peminjamanId}`
                    );
                    logWithTimestamp(
                      `Buzzer dimatikan untuk peminjaman ${peminjamanId}`
                    );
                  } catch (error) {
                    console.error("Error mematikan buzzer:", error);
                  }
                }, 30 * 1000); // 30 detik
              } catch (error) {
                console.error("Error menyalakan buzzer:", error);
                buzzerActivated = false;
              }
            }
          } catch (error) {
            console.error("Error in monitoring interval:", error);
          }
        }, 30 * 1000); // Check setiap 30 detik
        // const relayResponse = await axios.post(alamatEsp, { button: true });
        // logWithTimestamp(`Relay response: ${relayResponse.status}`);

        // if (relayResponse.status === 201) {
        //   peminjaman.isStarted = true;
        //   await peminjaman.save();
        //   // Reset buzzer status
        //   const SensorModel = getModelByType(type, "sensor");
        //   // Jadwalkan monitoring waktu peminjaman
        //   // Reset buzzer status
        //   await SensorModel.updateOne(
        //     {},
        //     {
        //       $set: {
        //         buzzerStatus: false,
        //         lastBuzzerActivation: null,
        //       },
        //     }
        //   );

        //   let buzzerActivated = false; // Flag untuk tracking status buzzer

        //   // Jadwalkan monitoring waktu peminjaman
        //   const monitorInterval = setInterval(async () => {
        //     try {
        //       const now = new Date();
        //       const endTime = new Date(akhirPeminjamanDate);
        //       const timeLeft = endTime - now;

        //       // Jika waktu sudah habis atau peminjaman tidak aktif, clear interval
        //       if (timeLeft <= 0 || !peminjaman.isStarted) {
        //         clearInterval(monitorInterval);

        //         // Pastikan buzzer dan relay mati
        //         try {
        //           await axios.post(alamatEsp, {
        //             button: false,
        //             buzzer: false
        //           });

        //           // Reset status di database
        //           await SensorModel.updateOne(
        //             {},
        //             {
        //               $set: {
        //                 buzzerStatus: false,
        //                 lastBuzzerActivation: null,
        //               },
        //             }
        //           );
        //         } catch (error) {
        //           console.error("Error mematikan perangkat:", error);
        //         }
        //         return;
        //       }

        //       // Jika waktu tersisa 5 menit atau kurang dan buzzer belum diaktifkan
        //       if (timeLeft <= 5 * 60 * 1000 && timeLeft > 0 && !buzzerActivated) {
        //         const sensorData = await SensorModel.findOne({});

        //         // Cek apakah buzzer sudah diaktifkan dalam 5 menit terakhir
        //         const lastActivation = sensorData?.lastBuzzerActivation;
        //         const timeSinceLastActivation = lastActivation
        //           ? now - new Date(lastActivation)
        //           : Infinity;

        //         // Aktifkan buzzer jika belum diaktifkan
        //         if (!sensorData?.buzzerStatus && timeSinceLastActivation > 5 * 60 * 1000) {
        //           try {
        //             logWithTimestamp(`Menyalakan buzzer warning untuk peminjaman: ${peminjamanId}`);

        //             // Update status di database terlebih dahulu
        //             await SensorModel.updateOne(
        //               {},
        //               {
        //                 $set: {
        //                   buzzerStatus: true,
        //                   lastBuzzerActivation: now,
        //                 },
        //               }
        //             );

        //             // Kirim perintah ke ESP
        //             await axios.post(alamatEsp, {
        //               button: peminjaman.isStarted,
        //               buzzer: true
        //             });

        //             buzzerActivated = true; // Set flag
        //             logger.info(`Buzzer aktif for rental ${peminjamanId}`);

        //             // Matikan buzzer setelah 1 menit
        //             setTimeout(async () => {
        //               try {
        //                 await axios.post(alamatEsp, {
        //                   button: peminjaman.isStarted,
        //                   buzzer: false
        //                 });

        //                 await SensorModel.updateOne(
        //                   {},
        //                   {
        //                     $set: { buzzerStatus: false },
        //                   }
        //                 );

        //                 logger.info(`Buzzer dimatikan untuk peminjaman ${peminjamanId}`);
        //               } catch (error) {
        //                 console.error("Error mematikan buzzer:", error);
        //               }
        //             }, 60 * 1000);
        //           } catch (error) {
        //             console.error("Error menyalakan buzzer:", error);
        //             buzzerActivated = false; // Reset flag jika gagal
        //           }
        //         }
        //       }
        //     } catch (error) {
        //       console.error("Error in monitoring interval:", error);
        //     }
        //   }, 30 * 1000);

        logWithTimestamp(
          `Relay berhasil dinyalakan untuk peminjaman: ${peminjamanId}`
        );

        // Variable untuk menyimpan timeout ID
        let shutdownTimeout = null;

        // Fungsi untuk mematikan relay
        const turnOffRelay = async () => {
          try {
            logger.info(`Mematikan relay untuk peminjaman ${peminjamanId}`);
            const relayOffResponse = await axios.post(alamatEsp, {
              button: false,
            });
            logWithTimestamp(
              `Relay dimatikan untuk peminjaman ${peminjamanId}, response: ${relayOffResponse.status}`
            );

            if (relayOffResponse.status === 201) {
              peminjaman.isStarted = false;
              await peminjaman.save();
              logger.info(
                `Relay sukses dimatikan untuk peminjaman ${peminjamanId}`
              );
              logger.info(
                `Relay sukses dimatikan untuk peminjaman ${peminjamanId}`
              );
            }
          } catch (error) {
            console.error("Failed to turn off relay:", error);
            logger.error(
              `Failed to turn off relay for rental ${peminjamanId}: ${error.message}`
            );
          }
        };

        // Fungsi untuk mengatur timeout mematikan relay
        const scheduleShutdown = (endTime) => {
          // Batalkan timeout sebelumnya jika ada
          if (shutdownTimeout) {
            clearTimeout(shutdownTimeout);
          }

          const timeUntilEnd = endTime.getTime() - new Date().getTime();
          if (timeUntilEnd > 0) {
            logWithTimestamp(
              `Menjadwalkan mematikan relay untuk peminjaman ${peminjamanId} dalam ${timeUntilEnd}ms (${new Date(
                endTime
              ).toLocaleString()})`
            );
            shutdownTimeout = setTimeout(turnOffRelay, timeUntilEnd);
          }
        };

        // Set timeout awal untuk mematikan relay
        scheduleShutdown(akhirPeminjamanDate);

        // Set interval untuk monitoring perpanjangan
        const checkInterval = setInterval(async () => {
          try {
            const updatedPeminjaman = await Model.findById(peminjamanId);

            const currentAkhirDate = convertTimeStringToDate(
              updatedPeminjaman.akhir_peminjaman,
              baseDate
            );

            if (!currentAkhirDate) {
              clearInterval(checkInterval);
              if (shutdownTimeout) clearTimeout(shutdownTimeout);
              return;
            }

            const now = new Date();

            // Cek apakah ada perpanjangan waktu
            if (currentAkhirDate > akhirPeminjamanDate) {
              logWithTimestamp(
                `Peminjaman diperpanjang dari ${akhirPeminjamanDate.toLocaleString()} ke ${currentAkhirDate.toLocaleString()}`
              );

              // Update waktu akhir
              akhirPeminjamanDate = currentAkhirDate;

              // Jadwalkan ulang shutdown dengan waktu yang baru
              scheduleShutdown(currentAkhirDate);

              // Pastikan relay menyala jika sebelumnya sudah mati
              if (!updatedPeminjaman.isStarted) {
                const relayOnResponse = await axios.post(alamatEsp, {
                  button: true,
                });
                if (relayOnResponse.status === 201) {
                  updatedPeminjaman.isStarted = true;
                  await updatedPeminjaman.save();
                }
              }
            }

            // Jika sudah melewati waktu akhir dan tidak ada perpanjangan
            if (now > currentAkhirDate && now > akhirPeminjamanDate) {
              clearInterval(checkInterval);
              if (shutdownTimeout) clearTimeout(shutdownTimeout);
              if (updatedPeminjaman.isStarted) {
                await turnOffRelay();
              }
            }
          } catch (error) {
            console.error("Error in interval check:", error);
          }
        }, 60000); // Check setiap 1 menit

        return res
          .status(200)
          .json({ message: "Relay diaktifkan, peminjaman dimulai." });
      } else {
        return res.status(500).json({ message: "Gagal mengaktifkan relay." });
      }
    } catch (error) {
      console.error("Error saat mengaktifkan relay:", error);
      return res.status(500).json({ message: "Gagal memulai peminjaman." });
    }
  } catch (error) {
    console.error("Error saat memulai peminjaman:", error.message);
    return res.status(500).json({ message: "Gagal memulai peminjaman." });
  }
};

const buttonPeminjaman = async (req, res) => {
  const { type } = req.params;
  const { button, buzzer } = req.body;
  const Model = getModelByType(type, "sensor");

  try {
    // Kirim perintah ke ESP
    // await controlRelay(type, button);

    const SensorModel = await Model.create({
      button,
      buzzerStatus: buzzer,
      waktu: new Date(),
      lastBuzzerActivation: buzzer ? new Date() : null,
    });

    res.status(201).json({
      success: true,
      statusCode: res.statusCode,
      message: "Terunggah",
      data: SensorModel,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error mengunggah data",
    });
  }
};

const getLatestData = async (req, res) => {
  const { type } = req.params;
  const Model = getModelByType(type, "sensor");

  try {
    const latestButtonData = await Model.findOne({
      button: { $exists: true },
    }).sort({ waktu: -1 });
    const latestCurrentData = await Model.findOne({
      current: { $exists: true },
    }).sort({ waktu: -1 });

    const latestBuzzerData = await Model.findOne({
      buzzerStatus: { $exists: true },
    }).sort({ waktu: -1 });

    if (!latestButtonData && !latestCurrentData) {
      return res.status(404).json({
        success: false,
        message: "No data found",
      });
    }

    const responseData = {
      button: latestButtonData ? latestButtonData.button : false,
      current: latestCurrentData ? latestCurrentData.current : null,
      buzzerStatus: latestBuzzerData ? latestBuzzerData.buzzerStatus : false,
      waktu: latestCurrentData
        ? latestCurrentData.waktu
        : latestButtonData.waktu,
    };

    res.status(200).json({
      success: true,
      statusCode: res.statusCode,
      data: responseData,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error retrieving data",
    });
  }
};

const updateCurrent = async (req, res) => {
  const { type } = req.params;
  const { current } = req.body;
  const Model = getModelByType(type, "sensor");

  logWithTimestamp(
    `Received updateCurrent request for type: ${type}, current: ${current}`
  );

  logger.info(`Received current update - Type: ${type}, Current: ${current}`);

  try {
    // Validasi input
    if (current === undefined || current === null) {
      return res.status(400).json({
        success: false,
        message: "Current value is required",
      });
    }

    const currentValue = parseFloat(current);
    if (isNaN(currentValue)) {
      return res.status(400).json({
        success: false,
        message: "Invalid current value",
      });
    }

    const sensorData = {
      current: currentValue,
      waktu: new Date(),
    };

    const SensorModel = await Model.create(sensorData);

    logger.info(`Current data saved - Type: ${type}, Value: ${currentValue}`);

    // Broadcast current jika websocket tersedia
    if (typeof broadcastCurrent === "function") {
      broadcastCurrent(current, type);
    }

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Data arus terunggah",
      data: SensorModel,
    });
  } catch (error) {
    console.error("[HTTP] Update current error:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating current data",
    });
  }
};

const getLatestCurrent = async (req, res) => {
  const { type } = req.params;
  const Model = getModelByType(type, "sensor");

  try {
    const latestCurrentData = await Model.findOne({
      current: { $exists: true },
    }).sort({ waktu: -1 });

    if (!latestCurrentData) {
      return res.status(404).json({
        success: false,
        message: "No current data found",
      });
    }

    res.status(200).json({
      success: true,
      statusCode: res.statusCode,
      data: {
        current: latestCurrentData.current,
        waktu: latestCurrentData.waktu,
      },
    });
  } catch (error) {
    console.error("[HTTP] Get latest current error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving current data",
    });
  }
};

module.exports = {
  startRental,
  buttonPeminjaman,
  getLatestData,
  initializeWebSocket,
  updateCurrent,
  getLatestCurrent,
};

// -------------------------------------------------------------------------------------------------------------- //

// sensorController.js

// const axios = require("axios");
// const WebSocket = require("ws");
// const { performance } = require("perf_hooks");
// const mqtt = require("mqtt");
// const logger = require('../config/logger');

// const {
//   CncSensor,
//   LaserSensor,
//   PrintingSensor,
// } = require("../models/sensorModel");
// const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
// const {
//   getWebSocketServer,
//   broadcastCurrent,
// } = require("../config/websocketServer");

// const getModelByType = (type, context) => {
//   // console.log(`Type: ${type}, Context: ${context}`);

//   const normalizedType = type.toLowerCase().trim();

//   if (context === "peminjaman") {
//     switch (normalizedType) {
//       case "cnc":
//       case "cnc milling":
//       case "milling":
//         return Cnc;
//       case "laser":
//       case "laser cutting":
//       case "lasercutting":
//         return Laser;
//       case "printing":
//       case "3d printing":
//       case "3dprinting":
//         return Printing;
//       default:
//         throw new Error(`Invalid type for peminjaman: ${type}`);
//     }
//   } else if (context === "sensor") {
//     switch (normalizedType) {
//       case "cnc":
//       case "cnc milling":
//       case "milling":
//         return CncSensor;
//       case "laser":
//       case "laser cutting":
//       case "lasercutting":
//         return LaserSensor;
//       case "printing":
//       case "3d printing":
//       case "3dprinting":
//         return PrintingSensor;
//       default:
//         throw new Error(`Invalid type for sensor: ${type}`);
//     }
//   } else {
//     throw new Error(`Invalid context: ${context}`);
//   }
// };

// // const mqttClient = mqtt.connect("mqtt://localhost:1885", {
// //   username: "murtiMQTT", // your_username
// //   password: "admin123", // your_password
// // });

// // mqttClient.on("connect", () => {
// //   logWithTimestamp("Connected to MQTT Broker");
// //   mqttClient.subscribe("sensor/+/buttonStatus");
// //   mqttClient.subscribe("sensor/+/current");
// // });

// // mqttClient.on("error", (error) => {
// //   console.error("Connection to MQTT Broker failed:", error);
// // });

// // // Terima data dari ESP
// // mqttClient.on("message", async (topic, message) => {
// //   try {
// //     const payload = JSON.parse(message.toString());
// //     logWithTimestamp(`Received MQTT message on topic ${topic}:`, payload);

// //     const type = topic.split("/")[1]; // Ambil 'laser' dari 'sensor/laser/buttonStatus'
// //     const SensorModel = getModelByType(type, "sensor");

// //     // Format waktu jika hanya berupa jam dan menit (e.g., '17:53:58')
// //     let waktu;
// //     if (payload.timestamp.match(/^\d{2}:\d{2}:\d{2}$/)) {
// //       const now = new Date(); // Gunakan tanggal hari ini
// //       waktu = new Date(
// //         `${now.toISOString().split("T")[0]}T${payload.timestamp}Z`
// //       );
// //     } else {
// //       waktu = new Date(payload.timestamp);
// //     }

// //     // Periksa jika waktu adalah valid
// //     if (isNaN(waktu.getTime())) {
// //       throw new Error("Invalid Date format for waktu field");
// //     }

// //     // Simpan data sesuai tipe topik
// //     if (topic.includes("/buttonStatus")) {
// //       await SensorModel.create({
// //         button: payload.button,
// //         waktu: waktu,
// //       });
// //       logWithTimestamp(`Button status saved for ${type}:`, payload);
// //     } else if (topic.includes("/current")) {
// //       await SensorModel.create({
// //         current: payload.current,
// //         waktu: waktu,
// //       });
// //       // logWithTimestamp(`Current data saved for ${type}:`, payload);
// //     }
// //   } catch (error) {
// //     logWithTimestamp("Error processing MQTT message:", error);
// //   }
// // });

// function logWithTimestamp(message, data = null) {
//   const now = new Date(); // Current date and time
//   const preciseTime = performance.now(); // High-precision timestamp

//   const formattedDate = now.toLocaleDateString("id-ID", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//   });

//   const formattedTime = now.toLocaleTimeString("id-ID", {
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: false,
//   });

//   // Add milliseconds from performance.now()
//   const milliseconds = String(Math.floor(preciseTime % 1000)).padStart(3, "0");
//   const fullTimestamp = `${formattedDate}, ${formattedTime}.${milliseconds}`;

//   if (data) {
//     console.log(`[${fullTimestamp}] : ${message}`, data);
//     logger.info(`${message} ${JSON.stringify(data)}`);
//   } else {
//     console.log(`[${fullTimestamp}] : ${message}`);
//     logger.info(message);
//   }
// }

// function convertTimeStringToDate(timeString, baseDate) {
//   if (!timeString || !baseDate) {
//     console.error("ERROR: Invalid timeString or baseDate provided");
//     return null;
//   }

//   logWithTimestamp(
//     `Converting time string: ${timeString} with date: ${baseDate}`
//   );

//   try {
//     if (timeString.includes("T")) {
//       const dateFromISO = new Date(timeString);
//       if (!isNaN(dateFromISO.getTime())) {
//         return dateFromISO;
//       } else {
//         console.error("ERROR: Invalid ISO format time string.");
//         return null;
//       }
//     }

//     // Parse the time components
//     const timeMatch = timeString
//       .toLowerCase()
//       .match(/^(\d{1,2}):(\d{2}):?(\d{2})?\s*(am|pm)$/);
//     if (!timeMatch) {
//       console.error(`Invalid time format: ${timeString}`);
//       return null;
//     }

//     let [_, hours, minutes, seconds, period] = timeMatch;
//     hours = parseInt(hours, 10);
//     minutes = parseInt(minutes, 10);

//     // Validate hours and minutes
//     if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
//       console.error(`Invalid hours/minutes: ${hours}:${minutes}`);
//       return null;
//     }

//     // Convert to 24-hour format
//     if (period === "pm" && hours < 12) {
//       hours += 12;
//     } else if (period === "am" && hours === 12) {
//       hours = 0;
//     }

//     // Create new date object using the base date
//     const date = new Date(baseDate);
//     date.setHours(hours, minutes, 0, 0);

//     logWithTimestamp(`Converted date: ${date.toISOString()}`);

//     logWithTimestamp(
//       `Converted time components - Hours: ${hours}, Minutes: ${minutes}`
//     );
//     logWithTimestamp(`Final converted date: ${date.toISOString()}`);

//     return date;
//   } catch (error) {
//     console.error(`ERROR: Failed to convert timeString to Date: ${error}`);
//     return null;
//   }
// }

// let wss = null;

// function initializeWebSocket(websocketServer) {
//   wss = websocketServer;
//   console.log("[WebSocket] Initialized in sensorController");
// }

// const startRental = async (req, res) => {
//   logger.info("Aktivasi memulai peminjaman diterima");
//   logWithTimestamp("startRental diterima");
//   const { peminjamanId, type } = req.body;
//   logWithTimestamp(`Received peminjamanId: ${peminjamanId}, type: ${type}`);
//   logger.info(`Received peminjamanId: ${peminjamanId}, type: ${type}`);

//   if (!peminjamanId || !type) {
//     logger.error("peminjamanId dan type tidak disediakan");
//     return res
//       .status(400)
//       .json({ message: "peminjamanId dan type harus disediakan." });
//   }

//   try {
//     const Model = getModelByType(type, "peminjaman");

//     // Tambahkan validasi untuk memastikan Model ada
//     if (!Model) {
//       logWithTimestamp("Error: Invalid peminjaman type");
//       return res.status(400).json({ message: "Tipe peminjaman tidak valid." });
//     }

//     let peminjaman = await Model.findById(peminjamanId);

//     if (!peminjaman) {
//       return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
//     }

//     if (peminjaman.isStarted) {
//       console.log("Error: Peminjaman sudah dimulai.");
//       return res.status(400).json({ message: "Peminjaman sudah dimulai." });
//     }

//     const alamatEsp = peminjaman.alamat_esp;
//     const baseDate = new Date(peminjaman.tanggal_peminjaman);

//     logWithTimestamp(
//       `Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`
//     );

//     const awalPeminjamanDate = convertTimeStringToDate(
//       peminjaman.awal_peminjaman,
//       baseDate
//     );
//     let akhirPeminjamanDate = convertTimeStringToDate(
//       peminjaman.akhir_peminjaman,
//       baseDate
//     );

//     const now = new Date();

//     console.log(`awalPeminjamanDate: ${awalPeminjamanDate}`);
//     console.log(`akhirPeminjamanDate: ${akhirPeminjamanDate}`);
//     console.log(`Is now < awalPeminjamanDate?`, now < awalPeminjamanDate);
//     console.log(`Is now > akhirPeminjamanDate?`, now > akhirPeminjamanDate);

//     if (!awalPeminjamanDate || !akhirPeminjamanDate) {
//       console.error("Invalid waktu peminjaman format detected");
//       return res
//         .status(400)
//         .json({ message: "Invalid waktu peminjaman format." });
//     }

//     if (now < awalPeminjamanDate) {
//       console.log(
//         `Waktu sekarang (${now}) belum mencapai waktu awal peminjaman (${awalPeminjamanDate}).`
//       );
//       return res
//         .status(400)
//         .json({ message: "Waktu peminjaman belum dimulai." });
//     }

//     if (now > akhirPeminjamanDate) {
//       peminjaman.isStarted = false;
//       await peminjaman.save();
//       return res
//         .status(400)
//         .json({ message: "Waktu peminjaman sudah berakhir." });
//     }

//     try {
//       // Nyalakan relay
//       const relayResponse = await axios.post(alamatEsp, { button: true });
//       logWithTimestamp(`Relay response: ${relayResponse.status}`);

//       if (relayResponse.status === 201) {
//         peminjaman.isStarted = true;
//         await peminjaman.save();
//         // Reset buzzer status
//         const SensorModel = getModelByType(type, "sensor");
//         await SensorModel.updateOne(
//           {},
//           {
//             $set: {
//               buzzerStatus: false,
//               lastBuzzerActivation: null,
//             },
//           }
//         );

//         // Jadwalkan monitoring waktu peminjaman
//         const monitorInterval = setInterval(async () => {
//           try {
//             const now = new Date();
//             const endTime = new Date(akhirPeminjamanDate);
//             const timeLeft = endTime - now;

//             // Jika waktu tersisa 5 menit atau kurang
//             if (timeLeft <= 5 * 60 * 1000 && timeLeft > 0) {
//               const sensorData = await SensorModel.findOne({});

//               // Cek apakah buzzer sudah diaktifkan dalam 5 menit terakhir
//               const lastActivation = sensorData?.lastBuzzerActivation;
//               const timeSinceLastActivation = lastActivation
//                 ? now - new Date(lastActivation)
//                 : Infinity;

//               // Aktifkan buzzer jika belum diaktifkan dalam 5 menit terakhir
//               if (
//                 !sensorData?.buzzerStatus &&
//                 timeSinceLastActivation > 5 * 60 * 1000
//               ) {

//                 logWithTimestamp(`Menyalakan buzzer warning untuk peminjaman: ${peminjamanId}`);
//                 logger.info(`Menyalakan buzzer warning untuk peminjaman: ${peminjamanId}. Sisa waktu: ${Math.floor(timeLeft/1000)}s`);

//                 // Update status buzzer di database
//                 await SensorModel.updateOne(
//                   {},
//                   {
//                     $set: {
//                       buzzerStatus: true,
//                       lastBuzzerActivation: now,
//                     },
//                   }
//                 );

//                 // Kirim sinyal untuk menyalakan buzzer
//                 await axios.post(alamatEsp, { buzzer: true });
//                 logger.info(`Buzzer aktif for rental ${peminjamanId}`);

//                 // Matikan buzzer setelah 1 menit
//                 setTimeout(async () => {
//                   logWithTimestamp(`Mematikan buzzer warning untuk peminjaman: ${peminjamanId}`);
//                   logger.info(`Menonaktifkan buzzer untuk peminjaman ${peminjamanId}`);

//                   await SensorModel.updateOne(
//                     {},
//                     {
//                       $set: { buzzerStatus: false },
//                     }
//                   );
//                   await axios.post(alamatEsp, { buzzer: false });
//                   logger.info(`Buzzer tidak aktif untuk peminjaman ${peminjamanId}`);
//                 }, 60 * 1000); // 1 menit
//               }
//             }

//             // Jika waktu sudah habis, clear interval
//             if (timeLeft <= 0) {
//               clearInterval(monitorInterval);
//             }
//           } catch (error) {
//             console.error("Error in monitoring interval:", error);
//           }
//         }, 30 * 1000);
//         logWithTimestamp(`Relay berhasil dinyalakan untuk peminjaman: ${peminjamanId}`);

//         // Variable untuk menyimpan timeout ID
//         let shutdownTimeout = null;

//         // Fungsi untuk mematikan relay
//         const turnOffRelay = async () => {
//           try {
//             logger.info(`Mematikan relay untuk peminjaman ${peminjamanId}`);
//             const relayOffResponse = await axios.post(alamatEsp, {
//               button: false,
//             });
//             logWithTimestamp(
//               `Relay dimatikan untuk peminjaman ${peminjamanId}, response: ${relayOffResponse.status}`
//             );

//             if (relayOffResponse.status === 201) {
//               peminjaman.isStarted = false;
//               await peminjaman.save();
//               logger.info(`Relay sukses dimatikan untuk peminjaman ${peminjamanId}`);
//             }
//           } catch (error) {
//             console.error("Failed to turn off relay:", error);
//             logger.error(`Failed to turn off relay for rental ${peminjamanId}: ${error.message}`);
//           }
//         };

//         // Fungsi untuk mengatur timeout mematikan relay
//         const scheduleShutdown = (endTime) => {
//           // Batalkan timeout sebelumnya jika ada
//           if (shutdownTimeout) {
//             clearTimeout(shutdownTimeout);
//           }

//           const timeUntilEnd = endTime.getTime() - new Date().getTime();
//           if (timeUntilEnd > 0) {
//             logWithTimestamp(
//               `Menjadwalkan mematikan relay untuk peminjaman ${peminjamanId} dalam ${timeUntilEnd}ms (${new Date(
//                 endTime
//               ).toLocaleString()})`
//             );
//             shutdownTimeout = setTimeout(turnOffRelay, timeUntilEnd);
//           }
//         };

//         // Set timeout awal untuk mematikan relay
//         scheduleShutdown(akhirPeminjamanDate);

//         // Set interval untuk monitoring perpanjangan
//         const checkInterval = setInterval(async () => {
//           try {
//             const updatedPeminjaman = await Model.findById(peminjamanId);

//             const currentAkhirDate = convertTimeStringToDate(
//               updatedPeminjaman.akhir_peminjaman,
//               baseDate
//             );

//             if (!currentAkhirDate) {
//               clearInterval(checkInterval);
//               if (shutdownTimeout) clearTimeout(shutdownTimeout);
//               return;
//             }

//             const now = new Date();

//             // Cek apakah ada perpanjangan waktu
//             if (currentAkhirDate > akhirPeminjamanDate) {
//               logWithTimestamp(
//                 `Peminjaman diperpanjang dari ${akhirPeminjamanDate.toLocaleString()} ke ${currentAkhirDate.toLocaleString()}`
//               );

//               // Update waktu akhir
//               akhirPeminjamanDate = currentAkhirDate;

//               // Jadwalkan ulang shutdown dengan waktu yang baru
//               scheduleShutdown(currentAkhirDate);

//               // Pastikan relay menyala jika sebelumnya sudah mati
//               if (!updatedPeminjaman.isStarted) {
//                 const relayOnResponse = await axios.post(alamatEsp, {
//                   button: true,
//                 });
//                 if (relayOnResponse.status === 201) {
//                   updatedPeminjaman.isStarted = true;
//                   await updatedPeminjaman.save();
//                 }
//               }
//             }

//             // Jika sudah melewati waktu akhir dan tidak ada perpanjangan
//             if (now > currentAkhirDate && now > akhirPeminjamanDate) {
//               clearInterval(checkInterval);
//               if (shutdownTimeout) clearTimeout(shutdownTimeout);
//               if (updatedPeminjaman.isStarted) {
//                 await turnOffRelay();
//               }
//             }
//           } catch (error) {
//             console.error("Error in interval check:", error);
//           }
//         }, 60000); // Check setiap 1 menit

//         return res
//           .status(200)
//           .json({ message: "Relay diaktifkan, peminjaman dimulai." });
//       } else {
//         return res.status(500).json({ message: "Gagal mengaktifkan relay." });
//       }
//     } catch (error) {
//       console.error("Error saat mengaktifkan relay:", error);
//       return res.status(500).json({ message: "Gagal memulai peminjaman." });
//     }
//   } catch (error) {
//     console.error("Error saat memulai peminjaman:", error.message);
//     return res.status(500).json({ message: "Gagal memulai peminjaman." });
//   }
// };

// // const buttonPeminjaman = async (req, res) => {
// //   const { type } = req.params;
// //   const { button } = req.body;
// //   const Model = getModelByType(type, "sensor");

// //   try {
// //     // Siapkan pesan MQTT
// //     const message = {
// //       button,
// //       timestamp: new Date().toISOString(),
// //     };

// //     // Kirim perintah ke ESP melalui MQTT
// //     mqttClient.publish(
// //       `sensor/${type}/buttonStatus`,
// //       JSON.stringify(message),
// //       { qos: 1 },
// //       async (err) => {
// //         if (err) {
// //           throw new Error("Failed to send MQTT message");
// //         }

// //         // Simpan ke database
// //         const SensorModel = await Model.create({
// //           button,
// //           waktu: new Date(),
// //         });

// //         res.status(201).json({
// //           success: true,
// //           statusCode: res.statusCode,
// //           message: "Terunggah",
// //           data: SensorModel,
// //         });
// //       }
// //     );
// //   } catch (error) {
// //     console.error(error);
// //     res.status(500).json({
// //       success: false,
// //       message: "Error mengunggah data",
// //     });
// //   }
// // };

// // Fungsi untuk mengirim perintah ke ESP
// // const controlRelay = async (type, button, endTime = null) => {
// //   return new Promise((resolve, reject) => {
// //     const message = {
// //       button,
// //       ...(endTime && { endTime: endTime.toISOString() }),
// //       timestamp: new Date().toISOString(),
// //     };

// //     mqttClient.publish(
// //       `sensor/${type}/buttonStatus`,
// //       JSON.stringify(message),
// //       { qos: 1 },
// //       (err) => {
// //         if (err) {
// //           logWithTimestamp("Error sending relay control:", err);
// //           reject(err);
// //         } else {
// //           logWithTimestamp(`Relay control sent for ${type}:`, message);
// //           resolve();
// //         }
// //       }
// //     );
// //   });
// // };

// const buttonPeminjaman = async (req, res) => {
//   const { type } = req.params;
//   const { button, buzzer } = req.body;
//   const Model = getModelByType(type, "sensor");

//   try {
//     // Kirim perintah ke ESP
//     // await controlRelay(type, button);

//     const SensorModel = await Model.create({
//       button,
//       buzzerStatus: buzzer,
//       waktu: new Date(),
//       lastBuzzerActivation: buzzer ? new Date() : null,
//     });

//     res.status(201).json({
//       success: true,
//       statusCode: res.statusCode,
//       message: "Terunggah",
//       data: SensorModel,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Error mengunggah data",
//     });
//   }
// };

// const getLatestData = async (req, res) => {
//   const { type } = req.params;
//   const Model = getModelByType(type, "sensor");

//   try {
//     const latestButtonData = await Model.findOne({
//       button: { $exists: true },
//     }).sort({ waktu: -1 });
//     const latestCurrentData = await Model.findOne({
//       current: { $exists: true },
//     }).sort({ waktu: -1 });

//     const latestBuzzerData = await Model.findOne({
//       buzzerStatus: { $exists: true },
//     }).sort({ waktu: -1 });

//     if (!latestButtonData && !latestCurrentData) {
//       return res.status(404).json({
//         success: false,
//         message: "No data found",
//       });
//     }

//     const responseData = {
//       button: latestButtonData ? latestButtonData.button : false,
//       current: latestCurrentData ? latestCurrentData.current : null,
//       buzzerStatus: latestBuzzerData ? latestBuzzerData.buzzerStatus : false,
//       waktu: latestCurrentData
//         ? latestCurrentData.waktu
//         : latestButtonData.waktu,
//     };

//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: responseData,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Error retrieving data",
//     });
//   }
// };

// const updateCurrent = async (req, res) => {
//   const { type } = req.params;
//   const { current } = req.body;
//   const Model = getModelByType(type, "sensor");

//   logWithTimestamp(
//     `Received updateCurrent request for type: ${type}, current: ${current}`
//   );

//   logger.info(`Received current update - Type: ${type}, Current: ${current}`);

//   try {
//     // Validasi input
//     if (current === undefined || current === null) {
//       return res.status(400).json({
//         success: false,
//         message: "Current value is required",
//       });
//     }

//     const currentValue = parseFloat(current);
//     if (isNaN(currentValue)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid current value",
//       });
//     }

//     const sensorData = {
//       current: currentValue,
//       waktu: new Date(),
//     };

//     const SensorModel = await Model.create(sensorData);

//     logger.info(`Current data saved - Type: ${type}, Value: ${currentValue}`);

//     // Broadcast current jika websocket tersedia
//     if (typeof broadcastCurrent === "function") {
//       broadcastCurrent(current, type);
//     }

//     return res.status(201).json({
//       success: true,
//       statusCode: 201,
//       message: "Data arus terunggah",
//       data: SensorModel,
//     });
//   } catch (error) {
//     console.error("[HTTP] Update current error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error updating current data",
//     });
//   }
// };

// const getLatestCurrent = async (req, res) => {
//   const { type } = req.params;
//   const Model = getModelByType(type, "sensor");

//   try {
//     const latestCurrentData = await Model.findOne({
//       current: { $exists: true },
//     }).sort({ waktu: -1 });

//     if (!latestCurrentData) {
//       return res.status(404).json({
//         success: false,
//         message: "No current data found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: {
//         current: latestCurrentData.current,
//         waktu: latestCurrentData.waktu,
//       },
//     });
//   } catch (error) {
//     console.error("[HTTP] Get latest current error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error retrieving current data",
//     });
//   }
// };

// module.exports = {
//   startRental,
//   buttonPeminjaman,
//   getLatestData,
//   initializeWebSocket,
//   updateCurrent,
//   getLatestCurrent,
// };

// -------------------------------------------------------------------------------------------------------------- //
// ------------------------------------------------------------------------------------------------------------- //

// BACKUP 1 //

// sensorController.js

// const axios = require("axios");
// const WebSocket = require("ws");
// const { performance } = require("perf_hooks");
// // const mqtt = require("mqtt");

// const {
//   CncSensor,
//   LaserSensor,
//   PrintingSensor,
// } = require("../models/sensorModel");
// const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
// const {
//   getWebSocketServer,
//   broadcastCurrent,
// } = require("../config/websocketServer");

// // const mqttClient = mqtt.connect("mqtt://192.168.68.124:1883", {
// //   username: "AdminMQTT", // your_username
// //   password: "pwd123", // your_password
// // });

// // mqttClient.on("connect", () => {
// //   console.log("Connected to MQTT Broker with authentication");
// // });

// // mqttClient.on("error", (error) => {
// //   console.error("Connection to MQTT Broker failed:", error);
// // });

// const getModelByType = (type, context) => {
//   // console.log(`Type: ${type}, Context: ${context}`);

//   const normalizedType = type.toLowerCase().trim();

//   if (context === "peminjaman") {
//     switch (normalizedType) {
//       case "cnc":
//       case "cnc milling":
//       case "milling":
//         return Cnc;
//       case "laser":
//       case "laser cutting":
//       case "lasercutting":
//         return Laser;
//       case "printing":
//       case "3d printing":
//       case "3dprinting":
//         return Printing;
//       default:
//         throw new Error(`Invalid type for peminjaman: ${type}`);
//     }
//   } else if (context === "sensor") {
//     switch (normalizedType) {
//       case "cnc":
//       case "cnc milling":
//       case "milling":
//         return CncSensor;
//       case "laser":
//       case "laser cutting":
//       case "lasercutting":
//         return LaserSensor;
//       case "printing":
//       case "3d printing":
//       case "3dprinting":
//         return PrintingSensor;
//       default:
//         throw new Error(`Invalid type for sensor: ${type}`);
//     }
//   } else {
//     throw new Error(`Invalid context: ${context}`);
//   }
// };

// // function logWithTimestamp(message, data = null) {
// //   const now = new Date();
// //   const formattedTime = `${now.toLocaleString("id-ID", {
// //     day: "2-digit",
// //     month: "2-digit",
// //     year: "numeric",
// //     hour: "2-digit",
// //     minute: "2-digit",
// //     second: "2-digit",
// //     hour12: false,
// //   })}.${now.getMilliseconds().toString().padStart(3, '0')}`;

// //   if (data) {
// //     console.log(`[${formattedTime}] : ${message}`, data);
// //   } else {
// //     console.log(`[${formattedTime}] : ${message}`);
// //   }
// // }

// // function logWithTimestamp(message, data = null) {
// //   const now = performance.now(); // High-precision timestamp
// //   const formattedTime = `${Math.floor(now / 1000)}.${String(Math.floor(now % 1000)).padStart(3, '0')}`; // Seconds.milliseconds format

// //   if (data) {
// //     console.log(`[${formattedTime}] : ${message}`, data);
// //   } else {
// //     console.log(`[${formattedTime}] : ${message}`);
// //   }
// // }

// function logWithTimestamp(message, data = null) {
//   const now = new Date(); // Current date and time
//   const preciseTime = performance.now(); // High-precision timestamp

//   const formattedDate = now.toLocaleDateString("id-ID", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//   });

//   const formattedTime = now.toLocaleTimeString("id-ID", {
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: false,
//   });

//   // Add milliseconds from performance.now()
//   const milliseconds = String(Math.floor(preciseTime % 1000)).padStart(3, "0");
//   const fullTimestamp = `${formattedDate}, ${formattedTime}.${milliseconds}`;

//   if (data) {
//     console.log(`[${fullTimestamp}] : ${message}`, data);
//   } else {
//     console.log(`[${fullTimestamp}] : ${message}`);
//   }
// }

// // Fungsi untuk mengonversi timeString (ISO atau AM/PM) menjadi Date object
// // function convertTimeStringToDate(timeString, baseDate) {
// //   if (!timeString || !baseDate) {
// //     console.error("ERROR: Invalid timeString or baseDate provided");
// //     return null;
// //   }

// //   logWithTimestamp(
// //     `Converting time string: ${timeString} with date: ${baseDate}`
// //   );

// //   try {
// //     // Jika timeString berbentuk ISO 8601, langsung buat Date object
// //     if (timeString.includes("T")) {
// //       const dateFromISO = new Date(timeString);
// //       if (!isNaN(dateFromISO)) {
// //         console.log(`Converted ISO timeString to date object: ${dateFromISO}`);
// //         return dateFromISO;
// //       }
// //     }

// //     // Jika timeString berbentuk format 12-jam dengan AM/PM
// //     const [time, modifier] = timeString.split(" ");
// //     let [hours, minutes] = time.split(":").map(Number);

// //     // Konversi dari format 12-jam ke 24-jam
// //     if (modifier && modifier.toLowerCase() === "pm" && hours < 12) {
// //       hours += 12; // Ubah jam siang (PM) ke format 24-jam
// //     }
// //     if (modifier && modifier.toLowerCase() === "am" && hours === 12) {
// //       hours = 0; // Ubah jam 12 AM menjadi 00
// //     }

// //     const date = new Date(baseDate);
// //     date.setHours(hours, minutes, 0, 0); // Set jam dan menit yang dikonversi

// //     logWithTimestamp(`Converted to date object (24-hour format): ${date}`);
// //     return date;
// //   } catch (error) {
// //     console.error(`ERROR: Failed to convert timeString to Date: ${error}`);
// //     return null;
// //   }
// // }

// function convertTimeStringToDate(timeString, baseDate) {
//   if (!timeString || !baseDate) {
//     console.error("ERROR: Invalid timeString or baseDate provided");
//     return null;
//   }

//   logWithTimestamp(
//     `Converting time string: ${timeString} with date: ${baseDate}`
//   );

//   try {
//     // Handle ISO format
//     // if (timeString.includes("T")) {
//     //   const dateFromISO = new Date(timeString);
//     //   return isNaN(dateFromISO.getTime()) ? null : dateFromISO;
//     // }
//     if (timeString.includes("T")) {
//       const dateFromISO = new Date(timeString);
//       if (!isNaN(dateFromISO.getTime())) {
//         return dateFromISO;
//       } else {
//         console.error("ERROR: Invalid ISO format time string.");
//         return null;
//       }
//     }

//     // Parse the time components
//     const timeMatch = timeString
//       .toLowerCase()
//       .match(/^(\d{1,2}):(\d{2}):?(\d{2})?\s*(am|pm)$/);
//     if (!timeMatch) {
//       console.error(`Invalid time format: ${timeString}`);
//       return null;
//     }

//     let [_, hours, minutes, seconds, period] = timeMatch;
//     hours = parseInt(hours, 10);
//     minutes = parseInt(minutes, 10);

//     // Validate hours and minutes
//     if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
//       console.error(`Invalid hours/minutes: ${hours}:${minutes}`);
//       return null;
//     }

//     // Convert to 24-hour format
//     if (period === "pm" && hours < 12) {
//       hours += 12;
//     } else if (period === "am" && hours === 12) {
//       hours = 0;
//     }

//     // Create new date object using the base date
//     const date = new Date(baseDate);
//     date.setHours(hours, minutes, 0, 0);

//     logWithTimestamp(`Converted date: ${date.toISOString()}`);

//     logWithTimestamp(
//       `Converted time components - Hours: ${hours}, Minutes: ${minutes}`
//     );
//     logWithTimestamp(`Final converted date: ${date.toISOString()}`);

//     return date;
//   } catch (error) {
//     console.error(`ERROR: Failed to convert timeString to Date: ${error}`);
//     return null;
//   }
// }

// let wss = null;

// function initializeWebSocket(websocketServer) {
//   wss = websocketServer;
//   console.log("[WebSocket] Initialized in sensorController");
// }

// const startRental = async (req, res) => {
//   logWithTimestamp("startRental diterima");
//   const { peminjamanId, type } = req.body;
//   logWithTimestamp(`Received peminjamanId: ${peminjamanId}, type: ${type}`);

//   if (!peminjamanId || !type) {
//     return res
//       .status(400)
//       .json({ message: "peminjamanId dan type harus disediakan." });
//   }

//   try {
//     const Model = getModelByType(type, "peminjaman");

//     // Tambahkan validasi untuk memastikan Model ada
//     if (!Model) {
//       logWithTimestamp("Error: Invalid peminjaman type");
//       return res.status(400).json({ message: "Tipe peminjaman tidak valid." });
//     }

//     let peminjaman = await Model.findById(peminjamanId);

//     if (!peminjaman) {
//       return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
//     }

//     if (peminjaman.isStarted) {
//       console.log("Error: Peminjaman sudah dimulai.");
//       return res.status(400).json({ message: "Peminjaman sudah dimulai." });
//     }

//     const alamatEsp = peminjaman.alamat_esp;
//     const baseDate = new Date(peminjaman.tanggal_peminjaman);

//     logWithTimestamp(
//       `Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`
//     );

//     const awalPeminjamanDate = convertTimeStringToDate(
//       peminjaman.awal_peminjaman,
//       baseDate
//     );
//     let akhirPeminjamanDate = convertTimeStringToDate(
//       peminjaman.akhir_peminjaman,
//       baseDate
//     );

//     const now = new Date();

//     console.log(`awalPeminjamanDate: ${awalPeminjamanDate}`);
//     console.log(`akhirPeminjamanDate: ${akhirPeminjamanDate}`);
//     console.log(`Is now < awalPeminjamanDate?`, now < awalPeminjamanDate);
//     console.log(`Is now > akhirPeminjamanDate?`, now > akhirPeminjamanDate);

//     if (!awalPeminjamanDate || !akhirPeminjamanDate) {
//       console.error("Invalid waktu peminjaman format detected");
//       return res
//         .status(400)
//         .json({ message: "Invalid waktu peminjaman format." });
//     }

//     if (now < awalPeminjamanDate) {
//       console.log(
//         `Waktu sekarang (${now}) belum mencapai waktu awal peminjaman (${awalPeminjamanDate}).`
//       );
//       return res
//         .status(400)
//         .json({ message: "Waktu peminjaman belum dimulai." });
//     }

//     if (now > akhirPeminjamanDate) {
//       peminjaman.isStarted = false;
//       await peminjaman.save();
//       return res
//         .status(400)
//         .json({ message: "Waktu peminjaman sudah berakhir." });
//     }

//     try {
//       // Nyalakan relay
//       const relayResponse = await axios.post(alamatEsp, { button: true });
//       logWithTimestamp(`Relay response: ${relayResponse.status}`);

//       if (relayResponse.status === 201) {
//         peminjaman.isStarted = true;
//         await peminjaman.save();

//         // Variable untuk menyimpan timeout ID
//         let shutdownTimeout = null;

//         // Fungsi untuk mematikan relay
//         const turnOffRelay = async () => {
//           try {
//             const relayOffResponse = await axios.post(alamatEsp, {
//               button: false,
//             });
//             logWithTimestamp(
//               `Relay dimatikan, response: ${relayOffResponse.status}`
//             );

//             if (relayOffResponse.status === 201) {
//               peminjaman.isStarted = false;
//               await peminjaman.save();
//             }
//           } catch (error) {
//             console.error("Failed to turn off relay:", error);
//           }
//         };

//         // Fungsi untuk mengatur timeout mematikan relay
//         const scheduleShutdown = (endTime) => {
//           // Batalkan timeout sebelumnya jika ada
//           if (shutdownTimeout) {
//             clearTimeout(shutdownTimeout);
//           }

//           const timeUntilEnd = endTime.getTime() - new Date().getTime();
//           if (timeUntilEnd > 0) {
//             logWithTimestamp(
//               `Menjadwalkan mematikan relay dalam ${timeUntilEnd}ms (${new Date(
//                 endTime
//               ).toLocaleString()})`
//             );
//             shutdownTimeout = setTimeout(turnOffRelay, timeUntilEnd);
//           }
//         };

//         // Set timeout awal untuk mematikan relay
//         scheduleShutdown(akhirPeminjamanDate);

//         // Set interval untuk monitoring perpanjangan
//         const checkInterval = setInterval(async () => {
//           try {
//             const updatedPeminjaman = await Model.findById(peminjamanId);

//             const currentAkhirDate = convertTimeStringToDate(
//               updatedPeminjaman.akhir_peminjaman,
//               baseDate
//             );

//             if (!currentAkhirDate) {
//               clearInterval(checkInterval);
//               if (shutdownTimeout) clearTimeout(shutdownTimeout);
//               return;
//             }

//             const now = new Date();

//             // Cek apakah ada perpanjangan waktu
//             if (currentAkhirDate > akhirPeminjamanDate) {
//               logWithTimestamp(
//                 `Peminjaman diperpanjang dari ${akhirPeminjamanDate.toLocaleString()} ke ${currentAkhirDate.toLocaleString()}`
//               );

//               // Update waktu akhir
//               akhirPeminjamanDate = currentAkhirDate;

//               // Jadwalkan ulang shutdown dengan waktu yang baru
//               scheduleShutdown(currentAkhirDate);

//               // Pastikan relay menyala jika sebelumnya sudah mati
//               if (!updatedPeminjaman.isStarted) {
//                 const relayOnResponse = await axios.post(alamatEsp, {
//                   button: true,
//                 });
//                 if (relayOnResponse.status === 201) {
//                   updatedPeminjaman.isStarted = true;
//                   await updatedPeminjaman.save();
//                 }
//               }
//             }

//             // Jika sudah melewati waktu akhir dan tidak ada perpanjangan
//             if (now > currentAkhirDate && now > akhirPeminjamanDate) {
//               clearInterval(checkInterval);
//               if (shutdownTimeout) clearTimeout(shutdownTimeout);
//               if (updatedPeminjaman.isStarted) {
//                 await turnOffRelay();
//               }
//             }
//           } catch (error) {
//             console.error("Error in interval check:", error);
//           }
//         }, 60000); // Check setiap 1 menit

//         return res
//           .status(200)
//           .json({ message: "Relay diaktifkan, peminjaman dimulai." });
//       } else {
//         return res.status(500).json({ message: "Gagal mengaktifkan relay." });
//       }
//     } catch (error) {
//       console.error("Error saat mengaktifkan relay:", error);
//       return res.status(500).json({ message: "Gagal memulai peminjaman." });
//     }
//   } catch (error) {
//     console.error("Error saat memulai peminjaman:", error.message);
//     return res.status(500).json({ message: "Gagal memulai peminjaman." });
//   }
// };

// // const startRental = async (req, res) => {
// //   logWithTimestamp("startRental diterima");
// //   const { peminjamanId, type } = req.body;
// //   logWithTimestamp(`Received peminjamanId: ${peminjamanId}, type: ${type}`);

// //   if (!peminjamanId || !type) {
// //     return res
// //       .status(400)
// //       .json({ message: "peminjamanId dan type harus disediakan." });
// //   }

// //   try {
// //     const Model = getModelByType(type, "peminjaman");
// //     let peminjaman = await Model.findById(peminjamanId); // Ambil data peminjaman terbaru dari database

// //     if (!peminjaman) {
// //       return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
// //     }

// //     // Cek apakah peminjaman sudah dimulai
// //     if (peminjaman.isStarted) {
// //       console.log("Error: Peminjaman sudah dimulai.");
// //       return res.status(400).json({ message: "Peminjaman sudah dimulai." });
// //     }

// //     const alamatEsp = peminjaman.alamat_esp;
// //     const baseDate = new Date(peminjaman.tanggal_peminjaman); // Tanggal dasar (tanggal peminjaman)

// //     logWithTimestamp(
// //       `Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`
// //     );

// //     // Konversi waktu awal dan akhir peminjaman menjadi Date objects
// //     const awalPeminjamanDate = convertTimeStringToDate(
// //       peminjaman.awal_peminjaman,
// //       baseDate
// //     );

// //     if (!awalPeminjamanDate) {
// //       return res.status(400).json({
// //         message: "Invalid waktu peminjaman format.",
// //       });
// //     }

// //     let akhirPeminjamanDate = convertTimeStringToDate(
// //       peminjaman.akhir_peminjaman,
// //       baseDate
// //     );

// //     if (!awalPeminjamanDate || !akhirPeminjamanDate) {
// //       console.error("Invalid waktu peminjaman format detected");
// //       return res
// //         .status(400)
// //         .json({ message: "Invalid waktu peminjaman format." });
// //     }

// //     const now = new Date();

// //     // Cek apakah waktu peminjaman belum dimulai atau sudah berakhir
// //     if (now < awalPeminjamanDate) {
// //       console.log(
// //         `Waktu sekarang (${now}) belum mencapai waktu awal peminjaman (${awalPeminjamanDate}).`
// //       );
// //       return res
// //         .status(400)
// //         .json({ message: "Waktu peminjaman belum dimulai." });
// //     }

// //     if (now > akhirPeminjamanDate) {
// //       peminjaman.isStarted = false; // Reset status karena waktu sudah berakhir
// //       await peminjaman.save();
// //       return res
// //         .status(400)
// //         .json({ message: "Waktu peminjaman sudah berakhir." });
// //     }

// //     // // Nyalakan relay (tombol ON)
// //     // const relayResponse = await axios.post(`${alamatEsp}`, { button: true });
// //     // logWithTimestamp(`Relay response: ${relayResponse.status}`);

// //     // // Jika relay berhasil dinyalakan, update isStarted
// //     // if (relayResponse.status === 201) {
// //     //   peminjaman.isStarted = true; // Update status isStarted menjadi true
// //     //   await peminjaman.save(); // Simpan perubahan ke database
// //     // }

// //     // Saat handle relay error

// //     // Set interval untuk memeriksa update akhir peminjaman
// //     // const checkInterval = setInterval(async () => {
// //     //   try {
// //     //     // Ambil data terbaru dari database untuk memastikan akhir peminjaman terbaru
// //     //     const updatedPeminjaman = await Model.findById(peminjamanId);
// //     //     akhirPeminjamanDate = convertTimeStringToDate(
// //     //       updatedPeminjaman.akhir_peminjaman,
// //     //       baseDate
// //     //     );

// //     //     if (!akhirPeminjamanDate) {
// //     //       console.error("Invalid format untuk akhir peminjaman terbaru.");
// //     //       clearInterval(checkInterval);
// //     //       return;
// //     //     }

// //     //     const currentTime = new Date();

// //     //     if (currentTime >= akhirPeminjamanDate) {
// //     //       // Matikan relay ketika waktu peminjaman sudah habis
// //     //       const relayOffResponse = await axios.post(`${alamatEsp}`, {
// //     //         button: false,
// //     //       });
// //     //       logWithTimestamp(
// //     //         `Relay dimatikan, response: ${relayOffResponse.status}`
// //     //       );

// //     //       // Setelah relay dimatikan, reset isStarted ke false
// //     //       if (relayOffResponse.status === 201) {
// //     //         peminjaman.isStarted = false;
// //     //         await peminjaman.save();
// //     //       }
// //     //       clearInterval(checkInterval); // Hentikan interval ketika peminjaman selesai
// //     //     }
// //     //   } catch (error) {
// //     //     console.error(
// //     //       `Error dalam pengecekan akhir_peminjaman terbaru: ${error.message}`
// //     //     );
// //     //   }
// //     // }, 60000); // Cek setiap 1 menit (60000 ms)

// //     // res.status(200).json({ message: "Relay diaktifkan, peminjaman dimulai." });

// //     try {
// //       axios.post(alamatEsp, { button: true })
// //       .then(async (relayResponse) => {
// //         logWithTimestamp(`Relay response: ${relayResponse.status}`);
// //         if (relayResponse.status === 201) {
// //           peminjaman.isStarted = true;
// //           await peminjaman.save();
// //         }
// //       })
// //       // console.log("Calling axios.post with:", {
// //       //   url: peminjaman.alamat_esp,
// //       //   data: { button: true },
// //       // });
// //       // const relayResponse = await axios.post(peminjaman.alamat_esp, {
// //       //   button: true,
// //       // });
// //       // logWithTimestamp(`Relay response: ${relayResponse.status}`);
// //       // if (relayResponse.status !== 201) {
// //       //   return res.status(500).json({ message: "Gagal memulai peminjaman." });
// //       // }

// //       // peminjaman.isStarted = true;
// //       // await peminjaman.save();

// //       // Set interval untuk monitoring
// //       const checkInterval = setInterval(async () => {
// //         try {
// //           const updatedPeminjaman = await Model.findById(peminjamanId);
// //           const updatedAkhirDate = convertTimeStringToDate(
// //             updatedPeminjaman.akhir_peminjaman,
// //             baseDate
// //           );

// //           if (!updatedAkhirDate) {
// //             clearInterval(checkInterval);
// //             return;
// //           }

// //           const currentTime = new Date();
// //           if (currentTime >= updatedAkhirDate) {
// //             try {
// //               const relayOffResponse = await axios.post(peminjaman.alamat_esp, {
// //                 button: false,
// //               });
// //               logWithTimestamp(
// //                 `Relay dimatikan, response: ${relayOffResponse.status}`
// //               );
// //               if (relayOffResponse.status === 201) {
// //                 peminjaman.isStarted = false;
// //                 await peminjaman.save();
// //               }
// //             } catch (error) {
// //               console.error("Failed to turn off relay:", error);
// //             }
// //             clearInterval(checkInterval);
// //           }
// //         } catch (error) {
// //           console.error("Error in interval check:", error);
// //         }
// //       }, 60000);

// //       return res
// //         .status(200)
// //         .json({ message: "Relay diaktifkan, peminjaman dimulai." });
// //     } catch (error) {
// //       return res.status(500).json({ message: "Gagal memulai peminjaman." });
// //     }
// //   } catch (error) {
// //     console.error("Error saat memulai peminjaman:", error.message);
// //     res.status(500).json({ message: "Gagal memulai peminjaman." });
// //   }
// // };

// const buttonPeminjaman = async (req, res) => {
//   const { type } = req.params;
//   const { button } = req.body;
//   const Model = getModelByType(type, "sensor");

//   try {
//     const SensorModel = await Model.create({
//       button,
//     });

//     // Publish status button ke MQTT dengan topik "sensor/<type>/buttonStatus"
//     // const mqttTopic = `sensor/${type}/buttonStatus`;
//     // const mqttMessage = JSON.stringify({
//     //   button, // Status tombol: true atau false
//     //   timestamp: new Date().toISOString(), // Timestamp saat pengiriman
//     // });

//     // mqttClient.publish(mqttTopic, mqttMessage, (error) => {
//     //   if (error) {
//     //     console.error("Error publishing button status to MQTT:", error);
//     //   } else {
//     //     console.log(`Published button status to MQTT: ${mqttMessage}`);
//     //   }
//     // });

//     res.status(201).json({
//       success: true,
//       statusCode: res.statusCode,
//       message: "Terunggah",
//       data: SensorModel,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Error mengunggah data",
//     });
//   }
// };

// const getLatestData = async (req, res) => {
//   const { type } = req.params;
//   const Model = getModelByType(type, "sensor");

//   try {
//     const latestButtonData = await Model.findOne({
//       button: { $exists: true },
//     }).sort({ waktu: -1 });
//     const latestCurrentData = await Model.findOne({
//       current: { $exists: true },
//     }).sort({ waktu: -1 });

//     if (!latestButtonData && !latestCurrentData) {
//       return res.status(404).json({
//         success: false,
//         message: "No data found",
//       });
//     }

//     const responseData = {
//       button: latestButtonData ? latestButtonData.button : false,
//       current: latestCurrentData ? latestCurrentData.current : null,
//       waktu: latestCurrentData
//         ? latestCurrentData.waktu
//         : latestButtonData.waktu,
//     };

//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: responseData,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: "Error retrieving data",
//     });
//   }
// };

// const updateCurrent = async (req, res) => {
//   const { type } = req.params;
//   const { current } = req.body;
//   const Model = getModelByType(type, "sensor");

//   logWithTimestamp(
//     `Received updateCurrent request for type: ${type}, current: ${current}`
//   );

//   try {
//     // Validasi input
//     if (current === undefined || current === null) {
//       return res.status(400).json({
//         success: false,
//         message: "Current value is required",
//       });
//     }

//     const currentValue = parseFloat(current);
//     if (isNaN(currentValue)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid current value",
//       });
//     }

//     const sensorData = {
//       current: currentValue,
//       waktu: new Date(),
//     };

//     const SensorModel = await Model.create(sensorData);

//     // Broadcast current jika websocket tersedia
//     if (typeof broadcastCurrent === "function") {
//       broadcastCurrent(current, type);
//     }

//     return res.status(201).json({
//       success: true,
//       statusCode: 201,
//       message: "Data arus terunggah",
//       data: SensorModel,
//     });
//   } catch (error) {
//     console.error("[HTTP] Update current error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error updating current data",
//     });
//   }
// };

// const getLatestCurrent = async (req, res) => {
//   const { type } = req.params;
//   const Model = getModelByType(type, "sensor");

//   try {
//     const latestCurrentData = await Model.findOne({
//       current: { $exists: true },
//     }).sort({ waktu: -1 });

//     if (!latestCurrentData) {
//       return res.status(404).json({
//         success: false,
//         message: "No current data found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: {
//         current: latestCurrentData.current,
//         waktu: latestCurrentData.waktu,
//       },
//     });
//   } catch (error) {
//     console.error("[HTTP] Get latest current error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error retrieving current data",
//     });
//   }
// };

// module.exports = {
//   startRental,
//   buttonPeminjaman,
//   getLatestData,
//   initializeWebSocket,
//   updateCurrent,
//   getLatestCurrent,
// };

// ------------------------------------------------------------------------------------------------------------------ //

// // sensorController.js

// const axios = require('axios');

// const { CncSensor, LaserSensor, PrintingSensor } = require('../models/sensorModel');
// const { Cnc, Laser, Printing } = require('../models/peminjamanModel');

// const getModelByType = (type, context) => {
//     console.log(`Type: ${type}, Context: ${context}`);

//     const normalizedType = type.toLowerCase().trim();

//     if (context === 'peminjaman') {
//         switch (normalizedType) {
//             case 'cnc':
//             case 'cnc milling':
//             case 'milling':
//                 return Cnc;
//             case 'laser':
//             case 'laser cutting':
//             case 'lasercutting':
//                 return Laser;
//             case 'printing':
//             case '3d printing':
//             case '3dprinting':
//                 return Printing;
//             default:
//                 throw new Error(`Invalid type for peminjaman: ${type}`);
//         }
//     } else if (context === 'sensor') {
//         switch (normalizedType) {
//             case 'cnc':
//             case 'cnc milling':
//             case 'milling':
//                 return CncSensor;
//             case 'laser':
//             case 'laser cutting':
//             case 'lasercutting':
//                 return LaserSensor;
//             case 'printing':
//             case '3d printing':
//             case '3dprinting':
//                 return PrintingSensor;
//             default:
//                 throw new Error(`Invalid type for sensor: ${type}`);
//         }
//     } else {
//         throw new Error(`Invalid context: ${context}`);
//     }
// };

// // Fungsi untuk mengonversi timeString (ISO atau AM/PM) menjadi Date object
// function convertTimeStringToDate(timeString, baseDate) {
//     if (!timeString || !baseDate) {
//         console.error("ERROR: Invalid timeString or baseDate provided");
//         return null;
//     }

//     console.log(`Converting time string: ${timeString} with date: ${baseDate}`);

//     try {
//         // Jika timeString berbentuk ISO 8601, langsung buat Date object
//         if (timeString.includes('T')) {
//             const dateFromISO = new Date(timeString);
//             if (!isNaN(dateFromISO)) {
//                 console.log(`Converted ISO timeString to date object: ${dateFromISO}`);
//                 return dateFromISO;
//             }
//         }

//         // Jika timeString berbentuk format 12-jam dengan AM/PM
//         const [time, modifier] = timeString.split(' ');
//         let [hours, minutes] = time.split(':').map(Number);

//         // Konversi dari format 12-jam ke 24-jam
//         if (modifier && modifier.toLowerCase() === 'pm' && hours < 12) {
//             hours += 12;  // Ubah jam siang (PM) ke format 24-jam
//         }
//         if (modifier && modifier.toLowerCase() === 'am' && hours === 12) {
//             hours = 0;  // Ubah jam 12 AM menjadi 00
//         }

//         const date = new Date(baseDate);
//         date.setHours(hours, minutes, 0, 0);  // Set jam dan menit yang dikonversi

//         console.log(`Converted to date object (24-hour format): ${date}`);
//         return date;
//     } catch (error) {
//         console.error(`ERROR: Failed to convert timeString to Date: ${error}`);
//         return null;
//     }
// };

// Function to start rental and control ESP32 relay
// const startRental = async (req, res) => {
//     console.log("startRental diterima");
//     const { peminjamanId, type } = req.body;
//     console.log(`Received peminjamanId: ${peminjamanId}, type: ${type}`);
//     // const Model = getModelByType(type, 'peminjaman');

//     if (!peminjamanId || !type) {
//         return res.status(400).json({ message: "peminjamanId dan type harus disediakan." });
//     }

//     let peminjaman;
//     try {
//         const Model = getModelByType(type, 'peminjaman');
//         const peminjaman = await Model.findById(peminjamanId);

//         if (!peminjaman) {
//             return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
//         }

//         // Cek apakah peminjaman sudah dimulai
//         if (peminjaman.isStarted) {
//             console.log("Error: Peminjaman sudah dimulai.");
//             return res.status(400).json({ message: "Peminjaman sudah dimulai." });
//         }

//         const alamatEsp = peminjaman.alamat_esp;
//         const baseDate = new Date(peminjaman.tanggal_peminjaman);  // Tanggal dasar (tanggal peminjaman)

//         console.log(`Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`);

//         // Konversi waktu awal dan akhir peminjaman menjadi Date objects
//         const awalPeminjamanDate = convertTimeStringToDate(peminjaman.awal_peminjaman, baseDate);
//         const akhirPeminjamanDate = convertTimeStringToDate(peminjaman.akhir_peminjaman, baseDate);

//         if (!awalPeminjamanDate || !akhirPeminjamanDate) {
//             return res.status(400).json({
//                 message: "Invalid waktu peminjaman format."
//             });
//         }

//         console.log(`Converted Awal Peminjaman: ${awalPeminjamanDate}, Converted Akhir Peminjaman: ${akhirPeminjamanDate}`);

//         const now = new Date();

//         // Cek apakah peminjaman sudah dimulai
//         if (peminjaman.isStarted) {
//             // Jika waktu sudah berakhir, matikan relay dan reset status
//             if (now > akhirPeminjamanDate) {
//                 peminjaman.isStarted = false;
//                 await peminjaman.save();
//                 return res.status(400).json({
//                     message: "Waktu peminjaman sudah berakhir."
//                 });
//             }

//             return res.status(400).json({ message: "Peminjaman sudah dimulai." });
//         }

//         // Cek apakah waktu peminjaman belum dimulai atau sudah berakhir
//         if (now < awalPeminjamanDate) {
//             return res.status(400).json({
//                 message: "Waktu peminjaman belum dimulai."
//             });
//         }

//         if (now > akhirPeminjamanDate) {
//             peminjaman.isStarted = false; // Reset status karena waktu sudah berakhir
//             await peminjaman.save();
//             return res.status(400).json({
//                 message: "Waktu peminjaman sudah berakhir."
//             });
//         }

//         // const remainingTime = akhirPeminjamanDate - now;

//         // Jika waktu sudah berlalu
//         // if (remainingTime <= 0) {
//         //     // Update isStarted jadi false karena waktu sudah habis
//         //     peminjaman.isStarted = false;
//         //     await peminjaman.save();

//         //     return res.status(400).json({ message:
//         //         "Waktu peminjaman sudah berakhir."
//         //     });
//         // }

//         // Nyalakan relay (tombol ON)
//         const relayResponse = await axios.post(`${alamatEsp}`, { button: true });
//         console.log(`Relay response: ${relayResponse.status}`);

//         // Jika relay berhasil dinyalakan, update isStarted
//         if (relayResponse.status === 201) {
//             peminjaman.isStarted = true;  // Update status isStarted menjadi true
//             await peminjaman.save();  // Simpan perubahan ke database
//         }

//         // Set timer untuk mematikan relay saat akhir peminjaman tercapai
//         const remainingTime = akhirPeminjamanDate - now;
//         setTimeout(async () => {
//             try {
//                 const relayOffResponse = await axios.post(`${alamatEsp}`, { button: false });
//                 console.log(`Relay dimatikan, response: ${relayOffResponse.status}`);
//                 // Setelah relay dimatikan, reset isStarted ke false
//                 if (relayOffResponse.status === 201) {
//                     peminjaman.isStarted = false;
//                     await peminjaman.save();
//                 }
//             } catch (error) {
//                 console.error(`Gagal mematikan relay untuk ESP: ${alamatEsp}. Error: ${error.message}`);
//             }
//         }, remainingTime);

//         res.status(200).json({ message: "Relay diaktifkan, peminjaman dimulai." });
//     } catch (error) {
//         console.error("Error saat memulai peminjaman:", error.message);
//         res.status(500).json({ message: "Gagal memulai peminjaman." });
//         // Jika terjadi error, tetap perbarui isStarted untuk menghindari status yang salah
//         peminjaman.isStarted = false;
//         await peminjaman.save();
//     }
// };

// const startRental = async (req, res) => {
//     console.log("startRental diterima");
//     const { peminjamanId, type } = req.body;
//     console.log(`Received peminjamanId: ${peminjamanId}, type: ${type}`);

//     if (!peminjamanId || !type) {
//         return res.status(400).json({ message: "peminjamanId dan type harus disediakan." });
//     }

//     let peminjaman;
//     try {
//         const Model = getModelByType(type, 'peminjaman');
//         peminjaman = await Model.findById(peminjamanId);  // Hapus 'const' di sini

//         if (!peminjaman) {
//             return res.status(404).json({ message: "Peminjaman tidak ditemukan." });
//         }

//         // Cek apakah peminjaman sudah dimulai
//         if (peminjaman.isStarted) {
//             console.log("Error: Peminjaman sudah dimulai.");
//             return res.status(400).json({ message: "Peminjaman sudah dimulai." });
//         }

//         const alamatEsp = peminjaman.alamat_esp;
//         const baseDate = new Date(peminjaman.tanggal_peminjaman);  // Tanggal dasar (tanggal peminjaman)

//         console.log(`Awal Peminjaman: ${peminjaman.awal_peminjaman}, Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`);

//         // Konversi waktu awal dan akhir peminjaman menjadi Date objects
//         const awalPeminjamanDate = convertTimeStringToDate(peminjaman.awal_peminjaman, baseDate);
//         const akhirPeminjamanDate = convertTimeStringToDate(peminjaman.akhir_peminjaman, baseDate);

//         if (!awalPeminjamanDate || !akhirPeminjamanDate) {
//             return res.status(400).json({
//                 message: "Invalid waktu peminjaman format."
//             });
//         }

//         console.log(`Converted Awal Peminjaman: ${awalPeminjamanDate}, Converted Akhir Peminjaman: ${akhirPeminjamanDate}`);

//         const now = new Date();

//         // Cek apakah waktu peminjaman belum dimulai atau sudah berakhir
//         if (now < awalPeminjamanDate) {
//             return res.status(400).json({
//                 message: "Waktu peminjaman belum dimulai."
//             });
//         }

//         if (now > akhirPeminjamanDate) {
//             peminjaman.isStarted = false; // Reset status karena waktu sudah berakhir
//             await peminjaman.save();
//             return res.status(400).json({
//                 message: "Waktu peminjaman sudah berakhir."
//             });
//         }

//         // Nyalakan relay (tombol ON)
//         const relayResponse = await axios.post(`${alamatEsp}`, { button: true });
//         console.log(`Relay response: ${relayResponse.status}`);

//         // Jika relay berhasil dinyalakan, update isStarted
//         if (relayResponse.status === 201) {
//             peminjaman.isStarted = true;  // Update status isStarted menjadi true
//             await peminjaman.save();  // Simpan perubahan ke database
//         }

//         // Set timer untuk mematikan relay saat akhir peminjaman tercapai
//         const remainingTime = akhirPeminjamanDate - now;
//         setTimeout(async () => {
//             try {
//                 const relayOffResponse = await axios.post(`${alamatEsp}`, { button: false });
//                 console.log(`Relay dimatikan, response: ${relayOffResponse.status}`);
//                 // Setelah relay dimatikan, reset isStarted ke false
//                 if (relayOffResponse.status === 201) {
//                     peminjaman.isStarted = false;
//                     await peminjaman.save();
//                 }
//             } catch (error) {
//                 console.error(`Gagal mematikan relay untuk ESP: ${alamatEsp}. Error: ${error.message}`);
//             }
//         }, remainingTime);

//         res.status(200).json({ message: "Relay diaktifkan, peminjaman dimulai." });
//     } catch (error) {
//         console.error("Error saat memulai peminjaman:", error.message);
//         res.status(500).json({ message: "Gagal memulai peminjaman." });
//         // Jika terjadi error, tetap perbarui isStarted untuk menghindari status yang salah
//         if (peminjaman) {
//             peminjaman.isStarted = false;
//             await peminjaman.save();
//         }
//     }
// };

// Metode 1,
// const getModelByType = (type) => {
//     switch (type) {
//         case 'cnc':
//             return CncSensor;
//         case 'laser':
//             return LaserSensor;
//         case 'printing':
//             return PrintingSensor;
//         default:
//             throw new Error ('Invalid type parameter');
//     }
// };

// const getLatestData = async (req, res) => {
//     const { type } = req.params;
//     const Model = getModelByType(type);

//     try {
//         const latestData = await Model.findOne().sort({ waktu : -1 });

//         if (!latestData) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No data found"
//             });
//         }
//         res.status(200).json({
//             success: true,
//             statusCode: res.statusCode,
//             data: latestData
//         });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({
//             success: false,
//             message: "Error retrieving data"
//         });
//     }
// }
