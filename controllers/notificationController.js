// // notificationController.js
// const admin = require("firebase-admin");
// const User = require("../models/userModel");
// const { Cnc, Laser, Printing } = require("../models/peminjamanModel");

// function logWithTimestamp(message) {
//   const now = new Date();
//   const formattedTime = now.toLocaleString("id-ID", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: false,
//   });
//   console.log(`[${formattedTime}] : ${message}`);
// }

// const sendNotification = async (user, title, body, data = {}) => {
//   try {
//     if (!user.fcmToken) {
//       logWithTimestamp(`No FCM token for user: ${user.email}`);
//       return { success: false, message: "No FCM token available" };
//     }

//     const message = {
//       notification: {
//         title,
//         body,
//       },
//       data: {
//         ...data,
//         timestamp: new Date().toISOString(),
//         click_action: "FLUTTER_NOTIFICATION_CLICK",
//       },
//       token: user.fcmToken,
//       android: {
//         priority: "high",
//         notification: {
//           channelId: "peminjaman_channel",
//           priority: "high",
//           defaultSound: true,
//           defaultVibrateTimings: true,
//         },
//       },
//     };

//     const response = await admin.messaging().send(message);
//     logWithTimestamp(`Notification sent successfully to user: ${user.email}`);
//     return { success: true, messageId: response };
//   } catch (error) {
//     logWithTimestamp(`Error sending notification: ${error}`);
//     return { success: false, error: error.message };
//   }
// };

// const checkAndSendPeminjamanNotification = async (req, res) => {
//   try {
//     // 1. Validasi data user dari request
//     if (!req.user?.userId || !req.user?.email) {
//       logWithTimestamp("Missing user data in request");
//       return res.status(401).json({
//         success: false,
//         message: "Data user tidak ditemukan",
//       });
//     }

//     const { userId, email } = req.user;
//     const { peminjamanId } = req.params;

//     logWithTimestamp(
//       `Checking notification for peminjaman: ${peminjamanId} by user: ${email}`
//     );

//     // 2. Cari peminjaman berdasarkan koleksi
//     let peminjaman = null;

//     logWithTimestamp("Searching in CNC collection...");
//     peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });
//     if (!peminjaman) {
//       logWithTimestamp("Searching in Laser collection...");
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//     }
//     if (!peminjaman) {
//       logWithTimestamp("Searching in Printing collection...");
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       logWithTimestamp(`Peminjaman not found with ID: ${peminjamanId}`);
//       return res.status(404).json({
//         success: false,
//         message: "Peminjaman tidak ditemukan",
//       });
//     }

//     logWithTimestamp(
//       `Found peminjaman: ${peminjaman._id} with status: ${peminjaman.status}`
//     );

//     // 3. Validasi status peminjaman
//     if (!peminjaman.isStarted || peminjaman.status !== "Disetujui") {
//       logWithTimestamp(
//         `Invalid peminjaman state: isStarted=${peminjaman.isStarted}, status=${peminjaman.status}`
//       );
//       return res.status(400).json({
//         success: false,
//         message: "Peminjaman tidak aktif atau belum disetujui",
//       });
//     }

//     // 4. Cari user berdasarkan email
//     const user = await User.findOne({ email });
//     if (!user) {
//       logWithTimestamp(`User not found with email: ${email}`);
//       return res.status(404).json({
//         success: false,
//         message: "User tidak ditemukan",
//       });
//     }

//     logWithTimestamp(
//       `Found user: ${user.email} with FCM token: ${
//         user.fcmToken ? "present" : "missing"
//       }`
//     );

//     // 5. Validasi waktu akhir peminjaman
//     const endTimeValidation = validateDateTime(peminjaman.akhir_peminjaman);
//     if (!endTimeValidation.valid) {
//       logWithTimestamp(
//         `Invalid akhir_peminjaman: ${peminjaman.akhir_peminjaman}`
//       );
//       return res.status(400).json({
//         success: false,
//         message: "Waktu akhir_peminjaman tidak valid",
//         error: endTimeValidation.error,
//       });
//     }

//     const now = new Date();
//     const endTime = endTimeValidation.parsed;

//     logWithTimestamp(
//       `Parsed waktu: now=${now.toISOString()}, endTime=${endTime.toISOString()}`
//     );

//     // 6. Hitung waktu tersisa
//     const timeToEnd = Math.floor((endTime - now) / (1000 * 60)); // Dalam menit
//     if (isNaN(timeToEnd) || timeToEnd < 0) {
//       logWithTimestamp(
//         `Invalid timeToEnd calculation: ${timeToEnd}, now=${now.toISOString()}, endTime=${endTime.toISOString()}`
//       );
//       return res.status(400).json({
//         success: false,
//         message: "Kesalahan perhitungan waktu tersisa",
//       });
//     }

//     logWithTimestamp(`Time remaining: ${timeToEnd} minutes`);

//     // 7. Kirim notifikasi jika waktu tersisa <= 5 menit
//     if (timeToEnd <= 5 && timeToEnd > 0) {
//       logWithTimestamp(
//         `Sending notification for peminjaman ending in ${timeToEnd} minutes`
//       );

//       const notificationResult = await sendNotification(
//         user,
//         "Peminjaman Akan Berakhir",
//         `Peminjaman ${peminjaman.nama_mesin} akan berakhir dalam ${timeToEnd} menit`,
//         {
//           type: "peminjaman_reminder",
//           peminjamanId: peminjaman._id.toString(),
//           namaMesin: peminjaman.nama_mesin,
//           timeRemaining: timeToEnd.toString(),
//         }
//       );

//       logWithTimestamp("Notification result: ", notificationResult);

//       if (notificationResult.success) {
//         return res.status(200).json({
//           success: true,
//           message: "Notifikasi berhasil dikirim",
//           data: notificationResult,
//         });
//       } else {
//         return res.status(500).json({
//           success: false,
//           message: "Gagal mengirim notifikasi",
//           error: notificationResult.error,
//         });
//       }
//     }

//     // 8. Jika belum waktunya, kirim informasi waktu tersisa
//     logWithTimestamp(
//       `Not time to send notification yet. ${timeToEnd} minutes remaining`
//     );
//     return res.status(200).json({
//       success: true,
//       message: "Belum waktunya mengirim notifikasi",
//       data: {
//         timeRemaining: timeToEnd,
//         endTime: endTime.toISOString(),
//         currentTime: now.toISOString(),
//       },
//     });
//   } catch (error) {
//     console.error("Error in checkAndSendPeminjamanNotification:", error);
//     logWithTimestamp(`Error: ${error.message}`);
//     return res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan internal",
//       error: error.message,
//     });
//   }
// };

// // Tambahkan ini untuk debug format waktu
// function validateDateTime(dateTimeStr) {
//   try {
//     const date = new Date(dateTimeStr);
//     if (isNaN(date.getTime())) {
//       return {
//         valid: false,
//         error: "Invalid time value",
//       };
//     }
//     return {
//       valid: true,
//       parsed: date,
//       iso: date.toISOString(),
//     };
//   } catch (error) {
//     return {
//       valid: false,
//       error: error.message,
//     };
//   }
// }

// module.exports = {
//   sendNotification,
//   checkAndSendPeminjamanNotification,
// };

// const admin = require("firebase-admin");
// const User = require("../models/userModel");
// const { Cnc, Laser, Printing } = require("../models/peminjamanModel");

// function logWithTimestamp(message, details = null) {
//   const now = new Date();
//   const formattedTime = now.toLocaleString("id-ID", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: "2-digit",
//     hour12: false,
//   });
//   console.log(`[${formattedTime}] : ${message}`);
//   if (details) {
//     console.log(`[${formattedTime}] : Details ->`, details);
//   }
// }

// const validateDateTime = (dateTimeStr) => {
//   try {
//     const date = new Date(dateTimeStr);
//     if (isNaN(date.getTime())) {
//       return { valid: false, error: "Invalid Date Format" };
//     }
//     return { valid: true, parsed: date, iso: date.toISOString() };
//   } catch (error) {
//     return { valid: false, error: error.message };
//   }
// };

// const sendNotification = async (user, title, body, data = {}) => {
//   try {
//     if (!user.fcmToken) {
//       logWithTimestamp(`No FCM token for user: ${user.email}`);
//       return { success: false, message: "No FCM token available" };
//     }

//     const message = {
//       notification: { title, body },
//       data: {
//         ...data,
//         timestamp: new Date().toISOString(),
//         click_action: "FLUTTER_NOTIFICATION_CLICK",
//       },
//       token: user.fcmToken,
//       android: {
//         priority: "high",
//         notification: {
//           channelId: "peminjaman_channel",
//           priority: "high",
//           defaultSound: true,
//           defaultVibrateTimings: true,
//         },
//       },
//     };

//     const response = await admin.messaging().send(message);
//     logWithTimestamp(`Notification sent successfully to user: ${user.email}`);
//     return { success: true, messageId: response };
//   } catch (error) {
//     logWithTimestamp(`Error sending notification: ${error}`);
//     return { success: false, error: error.message };
//   }
// };

// const checkAndSendPeminjamanNotification = async (req, res) => {
//   try {
//     const { peminjamanId } = req.params;

//     if (!req.user?.userId || !req.user?.email) {
//       logWithTimestamp("Missing user data in request");
//       return res.status(401).json({
//         success: false,
//         message: "Data user tidak ditemukan",
//       });
//     }

//     const { userId, email } = req.user;
//     logWithTimestamp(`Checking notification for peminjaman: ${peminjamanId} by user: ${email}`);

//     let peminjaman = null;

//     logWithTimestamp("Searching in CNC collection...");
//     peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });

//     if (!peminjaman) {
//       logWithTimestamp("Searching in Laser collection...");
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       logWithTimestamp("Searching in Printing collection...");
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       logWithTimestamp(`Peminjaman not found with ID: ${peminjamanId}`);
//       return res.status(404).json({
//         success: false,
//         message: "Peminjaman tidak ditemukan",
//       });
//     }

//     logWithTimestamp(`Found peminjaman: ${peminjaman._id} with status: ${peminjaman.status}`);

//     if (!peminjaman.isStarted || peminjaman.status !== "Disetujui") {
//       logWithTimestamp(`Invalid peminjaman state: isStarted=${peminjaman.isStarted}, status=${peminjaman.status}`);
//       return res.status(400).json({
//         success: false,
//         message: "Peminjaman tidak aktif atau belum disetujui",
//       });
//     }

//     const user = await User.findOne({ email });
//     if (!user) {
//       logWithTimestamp(`User not found with email: ${email}`);
//       return res.status(404).json({
//         success: false,
//         message: "User tidak ditemukan",
//       });
//     }

//     logWithTimestamp(`Found user: ${user.email} with FCM token: ${user.fcmToken ? "present" : "missing"}`);

//     const now = new Date();
//     const endTimeValidation = validateDateTime(peminjaman.akhir_peminjaman);

//     if (!endTimeValidation.valid) {
//       logWithTimestamp(`Invalid akhir_peminjaman: ${peminjaman.akhir_peminjaman}`, endTimeValidation.error);
//       return res.status(400).json({
//         success: false,
//         message: "Waktu akhir_peminjaman tidak valid",
//         error: endTimeValidation.error,
//       });
//     }

//     const endTime = endTimeValidation.parsed;
//     const timeToEnd = Math.floor((endTime - now) / (1000 * 60));

//     logWithTimestamp("Time calculation details:", {
//       now: now.toISOString(),
//       endTime: endTime.toISOString(),
//       timeToEnd,
//     });

//     if (isNaN(timeToEnd) || timeToEnd < 0) {
//       logWithTimestamp(`Invalid timeToEnd calculation: ${timeToEnd}`);
//       return res.status(400).json({
//         success: false,
//         message: "Kesalahan perhitungan waktu tersisa",
//         data: { now, endTime, timeToEnd },
//       });
//     }

//     if (timeToEnd <= 5 && timeToEnd > 0) {
//       logWithTimestamp(`Sending notification for peminjaman ending in ${timeToEnd} minutes`);

//       const notificationResult = await sendNotification(
//         user,
//         "Peminjaman Akan Berakhir",
//         `Peminjaman ${peminjaman.nama_mesin} akan berakhir dalam ${timeToEnd} menit`,
//         {
//           type: "peminjaman_reminder",
//           peminjamanId: peminjaman._id.toString(),
//           namaMesin: peminjaman.nama_mesin,
//           timeRemaining: timeToEnd.toString(),
//         }
//       );

//       logWithTimestamp("Notification result:", notificationResult);

//       if (notificationResult.success) {
//         return res.status(200).json({
//           success: true,
//           message: "Notifikasi berhasil dikirim",
//           data: notificationResult,
//         });
//       } else {
//         return res.status(500).json({
//           success: false,
//           message: "Gagal mengirim notifikasi",
//           error: notificationResult.error,
//         });
//       }
//     }

//     logWithTimestamp(`Not time to send notification yet. ${timeToEnd} minutes remaining`);
//     return res.status(200).json({
//       success: true,
//       message: "Belum waktunya mengirim notifikasi",
//       data: {
//         timeRemaining: timeToEnd,
//         endTime: endTime.toISOString(),
//         currentTime: now.toISOString(),
//       },
//     });
//   } catch (error) {
//     logWithTimestamp(`Error: ${error.message}`);
//     return res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan internal",
//       error: error.message,
//     });
//   }
// };

// module.exports = {
//   sendNotification,
//   checkAndSendPeminjamanNotification,
// };

const admin = require("firebase-admin");
const User = require("../models/userModel");
const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
const Notification = require("../models/notificationModel");

function logWithTimestamp(message, details = null) {
  const now = new Date();
  const formattedTime = now.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (details) {
    console.log(`[${formattedTime}] : ${message}`, details);
  } else {
    console.log(`[${formattedTime}] : ${message}`);
  }
}

function parseTimeAmPm(timeStr, referenceDate = new Date()) {
  try {
    const timeParts = timeStr.match(/^(\d+):(\d+):(\d+)\s*(am|pm)$/i);
    if (!timeParts) {
      throw new Error("Invalid AM/PM time format");
    }

    let hours = parseInt(timeParts[1], 10);
    const minutes = parseInt(timeParts[2], 10);
    const seconds = parseInt(timeParts[3], 10);
    const period = timeParts[4].toLowerCase();

    if (period === "pm" && hours < 12) {
      hours += 12;
    } else if (period === "am" && hours === 12) {
      hours = 0;
    }

    const parsedDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      hours,
      minutes,
      seconds
    );

    return { valid: true, parsed: parsedDate, iso: parsedDate.toISOString() };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

async function sendNotification(user, title, body, data = {}) {
  try {
    if (!user.fcmToken) {
      logWithTimestamp(`No FCM token for user: ${user.email}`);
      return { success: false, message: "No FCM token available" };
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: new Date().toISOString(),
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      token: user.fcmToken,
      android: {
        priority: "high",
        notification: {
          channelId: "peminjaman_channel",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await admin.messaging().send(message);
    logWithTimestamp(`Notification sent successfully to user: ${user.email}`);
    return { success: true, messageId: response };
  } catch (error) {
    logWithTimestamp(`Error sending notification: ${error}`);
    return { success: false, error: error.message };
  }
}

async function sendStatusNotification(user, title, body, data = {}) {
  try {
    if (!user.fcmToken) {
      logWithTimestamp(`No FCM token for user: ${user.email}`);
      return { success: false, message: "No FCM token available" };
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        type: "peminjaman_status",
        timestamp: new Date().toISOString(),
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      token: user.fcmToken,
      android: {
        priority: "high",
        notification: {
          channelId: "peminjaman_channel",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await admin.messaging().send(message);
    logWithTimestamp(
      `Status notification sent successfully to user: ${user.email}`
    );

    // Save notification to database
    await Notification.create({
      userId: user._id,
      title,
      body,
      data: message.data,
      type: "peminjaman_status",
      read: false,
    });

    return { success: true, messageId: response };
  } catch (error) {
    logWithTimestamp(`Error sending status notification: ${error}`);
    return { success: false, error: error.message };
  }
}

async function checkAndSendPeminjamanNotification(req, res) {
  try {
    const { peminjamanId } = req.params;

    if (!req.user?.userId || !req.user?.email) {
      logWithTimestamp("Missing user data in request");
      return res.status(401).json({
        success: false,
        message: "Data user tidak ditemukan",
      });
    }

    const { userId, email } = req.user;

    logWithTimestamp(
      `Checking notification for peminjaman: ${peminjamanId} by user: ${email}`
    );

    let peminjaman = null;

    logWithTimestamp("Searching in CNC collection...");
    peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });

    if (!peminjaman) {
      logWithTimestamp("Searching in Laser collection...");
      peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
    }

    if (!peminjaman) {
      logWithTimestamp("Searching in Printing collection...");
      peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
    }

    if (!peminjaman || peminjaman.user.toString() !== userId.toString()) {
      logWithTimestamp(`Peminjaman not found or not owned by user: ${userId}`);
      return res.status(403).json({
        success: false,
        message: "Peminjaman tidak ditemukan atau Anda tidak memiliki izin",
      });
    }

    const user = await User.findOne({ email });
    if (!user || user._id.toString() !== peminjaman.user.toString()) {
      logWithTimestamp(`User not found or does not own the peminjaman`);
      return res.status(403).json({
        success: false,
        message: "User tidak ditemukan atau bukan pemilik peminjaman",
      });
    }

    logWithTimestamp(
      `Found user: ${user.email} with FCM token: ${
        user.fcmToken ? "present" : "missing"
      }`
    );

    if (!peminjaman.isStarted || peminjaman.status !== "Disetujui") {
      logWithTimestamp(
        `Invalid peminjaman state: isStarted=${peminjaman.isStarted}, status=${peminjaman.status}`
      );
      return res.status(400).json({
        success: false,
        message: "Peminjaman tidak aktif atau belum disetujui",
      });
    }

    const now = new Date();
    const parsedEndTime = parseTimeAmPm(peminjaman.akhir_peminjaman, now);

    if (!parsedEndTime.valid) {
      logWithTimestamp(
        `Invalid akhir_peminjaman: ${peminjaman.akhir_peminjaman}`,
        parsedEndTime.error
      );
      return res.status(400).json({
        success: false,
        message: "Waktu akhir_peminjaman tidak valid",
        error: parsedEndTime.error,
      });
    }

    const endTime = parsedEndTime.parsed;
    const timeToEnd = Math.floor((endTime - now) / (1000 * 60));

    logWithTimestamp("Time calculation details:", {
      now: now.toISOString(),
      endTime: endTime.toISOString(),
      timeToEnd,
    });

    if (timeToEnd <= 5 && timeToEnd > 0) {
      logWithTimestamp(
        `Sending notification for peminjaman ending in ${timeToEnd} minutes`
      );

      const notificationResult = await sendNotification(
        user,
        "Peminjaman Akan Berakhir",
        `Peminjaman ${peminjaman.nama_mesin} akan berakhir dalam ${timeToEnd} menit`,
        {
          type: "peminjaman_reminder",
          peminjamanId: peminjaman._id.toString(),
          namaMesin: peminjaman.nama_mesin,
          timeRemaining: timeToEnd.toString(),
        }
      );

      logWithTimestamp("Notification result:", notificationResult);

      if (notificationResult.success) {
        return res.status(200).json({
          success: true,
          message: "Notifikasi berhasil dikirim",
          data: {
            notificationResult,
            timeRemaining: timeToEnd,
            endTime: endTime.toISOString(),
          },
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Gagal mengirim notifikasi",
          error: notificationResult.error,
        });
      }
    }

    logWithTimestamp(
      `Not time to send notification yet. ${timeToEnd} minutes remaining`
    );
    return res.status(200).json({
      success: true,
      message: "Belum waktunya mengirim notifikasi",
      data: {
        timeRemaining: timeToEnd,
        endTime: endTime.toISOString(),
        currentTime: now.toISOString(),
      },
    });
  } catch (error) {
    logWithTimestamp(
      `Error in checkAndSendPeminjamanNotification: ${error.message}`
    );
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal",
      error: error.message,
    });
  }
}

// Fungsi untuk mengirim notifikasi ke admin
const sendAdminNotification = async (peminjaman, type) => {
  try {
    // Get all admin users
    const adminUsers = await User.find({ role: "admin" });

    if (!adminUsers || adminUsers.length === 0) {
      logWithTimestamp("No admin users found");
      return { success: false, message: "No admin users found" };
    }

    const notifications = [];

    // Customize notification based on machine type
    const getMachineDetails = (type) => {
      switch (type.toLowerCase()) {
        case "cnc":
          return { name: "CNC Milling", color: "#2196F3" };
        case "laser":
          return { name: "Laser Cutting", color: "#F44336" };
        case "printing":
          return { name: "Mesin 3D Printing", color: "#4CAF50" };
        default:
          return { name: type, color: "#9E9E9E" };
      }
    };

    const machineDetails = getMachineDetails(type);
    const title = "Permintaan Peminjaman Baru";
    const body = `Ada pengajuan peminjaman baru untuk ${machineDetails.name} dari ${peminjaman.nama_pemohon}`;

    const data = {
      type: "new_peminjaman",
      peminjamanId: peminjaman._id.toString(),
      machineType: type,
      requestTime: new Date().toISOString(),
      pemohon: peminjaman.nama_pemohon,
      jurusan: peminjaman.jurusan,
      programStudi: peminjaman.program_studi,
      tanggalPeminjaman: peminjaman.tanggal_peminjaman,
      waktuMulai: peminjaman.awal_peminjaman,
      waktuSelesai: peminjaman.akhir_peminjaman,
      status: peminjaman.status,
      color: machineDetails.color,
      click_action: "FLUTTER_NOTIFICATION_CLICK",
    };

    // Send notifications to all admins
    for (const adminUser of adminUsers) {
      if (adminUser.fcmToken) {
        try {
          const message = {
            notification: {
              title,
              body,
            },
            data,
            token: adminUser.fcmToken,
            android: {
              priority: "high",
              notification: {
                channelId: "peminjaman_channel",
                priority: "high",
                defaultSound: true,
                defaultVibrateTimings: true,
                color: machineDetails.color,
              },
            },
          };

          const response = await admin.messaging().send(message);

          notifications.push({
            adminId: adminUser._id,
            success: true,
            messageId: response,
          });
          logWithTimestamp(`Notification sent to admin: ${adminUser.email}`);

          // Save notification to database
          await Notification.create({
            userId: adminUser._id,
            title,
            body,
            data,
            type: "new_peminjaman",
            read: false,
          });
        } catch (error) {
          logWithTimestamp(
            `Failed to send notification to admin: ${adminUser.email}`,
            error.message
          );

          // Handle invalid FCM token
          if (
            error.errorInfo &&
            error.errorInfo.code ===
              "messaging/registration-token-not-registered"
          ) {
            logWithTimestamp(
              `Invalid FCM token for admin: ${adminUser.email}. Removing token from database.`
            );

            // Remove invalid FCM token from user
            await User.updateOne(
              { _id: adminUser._id },
              { $unset: { fcmToken: "" } }
            );
          }

          notifications.push({
            adminId: adminUser._id,
            success: false,
            error: error.message,
          });
        }
      } else {
        logWithTimestamp(`No FCM token for admin: ${adminUser.email}`);
      }
    }

    const successCount = notifications.filter((n) => n.success).length;
    const totalCount = notifications.length;

    return {
      success: successCount > 0,
      message: `Successfully sent notifications to ${successCount}/${totalCount} admins`,
      notifications,
    };
  } catch (error) {
    logWithTimestamp("Error in sendAdminNotification:", error.message);
    return { success: false, error: error.message };
  }
};

const NotificationController = {
  // Handler untuk mengirim notifikasi ke admin saat ada peminjaman baru
  handleNewPeminjaman: async (req, res, next) => {
    try {
      const { type } = req.params;
      const peminjaman = req.body;

      const notificationResult = await sendAdminNotification(peminjaman, type);

      if (!notificationResult.success) {
        logWithTimestamp("Failed to send admin notifications");
      }

      next();
    } catch (error) {
      logWithTimestamp("Error in handleNewPeminjaman:", error);
      next(error);
    }
  },

  // Handler untuk mendapatkan status notifikasi
  getNotificationStatus: async (req, res) => {
    try {
      const userId = req.user.userId;
      const notifications = await Notification.find({ userId })
        .sort({ createdAt: -1 })
        .limit(50);

      const hasUnread = notifications.some((notif) => !notif.read);

      res.status(200).json({
        success: true,
        hasUnread,
        notifications,
      });
    } catch (error) {
      logWithTimestamp("Error getting notification status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get notification status",
        error: error.message,
      });
    }
  },

  // Handler untuk mengupdate status notifikasi
  updateNotificationStatus: async (req, res) => {
    try {
      const { notificationId } = req.params;
      const { read } = req.body;
      const userId = req.user.userId;

      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { read },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      res.status(200).json({
        success: true,
        notification,
      });
    } catch (error) {
      logWithTimestamp("Error updating notification status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update notification status",
        error: error.message,
      });
    }
  },

  // Handler untuk mendapatkan notifikasi user
  getUserNotifications: async (req, res) => {
    try {
      const userId = req.user.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      const notifications = await Notification.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const total = await Notification.countDocuments({ userId });

      res.status(200).json({
        success: true,
        data: {
          notifications,
          page,
          totalPages: Math.ceil(total / limit),
          total,
        },
      });
    } catch (error) {
      logWithTimestamp("Error getting user notifications:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get notifications",
        error: error.message,
      });
    }
  },
};

module.exports = {
  sendNotification,
  sendStatusNotification,
  checkAndSendPeminjamanNotification,
  sendAdminNotification,
  NotificationController,
};

// const sendAdminNotification = async (peminjaman, type) => {
//   try {
//     // Get all admin users
//     const adminUsers = await User.find({ role: "admin" });

//     if (!adminUsers || adminUsers.length === 0) {
//       logWithTimestamp("No admin users found");
//       return { success: false, message: "No admin users found" };
//     }

//     const notifications = [];

//     // Customize notification based on machine type
//     const getMachineDetails = (type) => {
//       switch (type.toLowerCase()) {
//         case "cnc":
//           return { name: "CNC Milling", color: "#2196F3" };
//         case "laser":
//           return { name: "Laser Cutting", color: "#F44336" };
//         case "printing":
//           return { name: "Mesin 3D Printing", color: "#4CAF50" };
//         default:
//           return { name: type, color: "#9E9E9E" };
//       }
//     };

//     const machineDetails = getMachineDetails(type);
//     const title = "Permintaan Peminjaman Baru";
//     const body = `Ada pengajuan peminjaman baru untuk ${machineDetails.name} dari ${peminjaman.nama_pemohon}`;

//     const data = {
//       type: "new_peminjaman",
//       peminjamanId: peminjaman._id.toString(),
//       machineType: type,
//       requestTime: new Date().toISOString(),
//       pemohon: peminjaman.nama_pemohon,
//       jurusan: peminjaman.jurusan,
//       programStudi: peminjaman.program_studi,
//       tanggalPeminjaman: peminjaman.tanggal_peminjaman,
//       waktuMulai: peminjaman.awal_peminjaman,
//       waktuSelesai: peminjaman.akhir_peminjaman,
//       status: peminjaman.status,
//       color: machineDetails.color,
//       click_action: "FLUTTER_NOTIFICATION_CLICK",
//     };

//     // Send notifications to all admins
//     for (const adminUser of adminUsers) {
//       if (adminUser.fcmToken) {
//         try {
//           const message = {
//             notification: {
//               title,
//               body,
//             },
//             data,
//             token: adminUser.fcmToken,
//             android: {
//               priority: "high",
//               notification: {
//                 channelId: "peminjaman_channel",
//                 priority: "high",
//                 defaultSound: true,
//                 defaultVibrateTimings: true,
//                 color: machineDetails.color,
//               },
//             },
//           };

//           const response = await admin.messaging().send(message);
//           notifications.push({
//             adminId: adminUser._id,
//             success: true,
//             messageId: response,
//           });
//           logWithTimestamp(`Notification sent to admin: ${adminUser.email}`);

//           // Save notification to database
//           await Notification.create({
//             userId: adminUser._id,
//             title,
//             body,
//             data,
//             type: "new_peminjaman",
//             read: false,
//           });
//         } catch (error) {
//           logWithTimestamp(
//             `Failed to send notification to admin: ${adminUser.email}`,
//             error
//           );
//           notifications.push({
//             adminId: adminUser._id,
//             success: false,
//             error: error.message,
//           });
//         }
//       }
//     }

//     const successCount = notifications.filter((n) => n.success).length;
//     const totalCount = notifications.length;

//     return {
//       success: successCount > 0,
//       message: `Successfully sent notifications to ${successCount}/${totalCount} admins`,
//       notifications,
//     };
//   } catch (error) {
//     logWithTimestamp("Error in sendAdminNotification:", error);
//     return { success: false, error: error.message };
//   }
// };

// async function checkAndSendPeminjamanNotification(req, res) {
//   try {
//     const { peminjamanId } = req.params;

//     if (!req.user?.userId || !req.user?.email) {
//       logWithTimestamp("Missing user data in request");
//       return res.status(401).json({
//         success: false,
//         message: "Data user tidak ditemukan",
//       });
//     }

//     const { userId, email } = req.user;

//     logWithTimestamp(`Checking notification for peminjaman: ${peminjamanId} by user: ${email}`);

//     let peminjaman = null;

//     logWithTimestamp("Searching in CNC collection...");
//     peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });

//     if (!peminjaman) {
//       logWithTimestamp("Searching in Laser collection...");
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       logWithTimestamp("Searching in Printing collection...");
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       logWithTimestamp(`Peminjaman not found with ID: ${peminjamanId}`);
//       return res.status(404).json({
//         success: false,
//         message: "Peminjaman tidak ditemukan",
//       });
//     }

//     logWithTimestamp(`Found peminjaman: ${peminjaman._id} with status: ${peminjaman.status}`);

//     if (!peminjaman.isStarted || peminjaman.status !== "Disetujui") {
//       logWithTimestamp(`Invalid peminjaman state: isStarted=${peminjaman.isStarted}, status=${peminjaman.status}`);
//       return res.status(400).json({
//         success: false,
//         message: "Peminjaman tidak aktif atau belum disetujui",
//       });
//     }

//     const user = await User.findOne({ email });
//     if (!user) {
//       logWithTimestamp(`User not found with email: ${email}`);
//       return res.status(404).json({
//         success: false,
//         message: "User tidak ditemukan",
//       });
//     }

//     logWithTimestamp(`Found user: ${user.email} with FCM token: ${user.fcmToken ? "present" : "missing"}`);

//     const now = new Date();
//     const parsedEndTime = parseTimeAmPm(peminjaman.akhir_peminjaman, now);

//     if (!parsedEndTime.valid) {
//       logWithTimestamp(`Invalid akhir_peminjaman: ${peminjaman.akhir_peminjaman}`, parsedEndTime.error);
//       return res.status(400).json({
//         success: false,
//         message: "Waktu akhir_peminjaman tidak valid",
//         error: parsedEndTime.error,
//       });
//     }

//     const endTime = parsedEndTime.parsed;
//     const timeToEnd = Math.floor((endTime - now) / (1000 * 60));

//     logWithTimestamp("Time calculation details:", {
//       now: now.toISOString(),
//       endTime: endTime.toISOString(),
//       timeToEnd,
//     });

//     if (timeToEnd <= 5 && timeToEnd > 0) {
//       logWithTimestamp(`Sending notification for peminjaman ending in ${timeToEnd} minutes`);

//       const notificationResult = await sendNotification(
//         user,
//         "Peminjaman Akan Berakhir",
//         `Peminjaman ${peminjaman.nama_mesin} akan berakhir dalam ${timeToEnd} menit`,
//         {
//           type: "peminjaman_reminder",
//           peminjamanId: peminjaman._id.toString(),
//           namaMesin: peminjaman.nama_mesin,
//           timeRemaining: timeToEnd.toString(),
//         }
//       );

//       logWithTimestamp("Notification result:", notificationResult);

//       if (notificationResult.success) {
//         return res.status(200).json({
//           success: true,
//           message: "Notifikasi berhasil dikirim",
//           data: {
//             notificationResult,
//             timeRemaining: timeToEnd,
//             endTime: endTime.toISOString(),
//           },
//         });
//       } else {
//         return res.status(500).json({
//           success: false,
//           message: "Gagal mengirim notifikasi",
//           error: notificationResult.error,
//         });
//       }
//     }

//     logWithTimestamp(`Not time to send notification yet. ${timeToEnd} minutes remaining`);
//     return res.status(200).json({
//       success: true,
//       message: "Belum waktunya mengirim notifikasi",
//       data: {
//         timeRemaining: timeToEnd,
//         endTime: endTime.toISOString(),
//         currentTime: now.toISOString(),
//       },
//     });
//   } catch (error) {
//     logWithTimestamp(`Error in checkAndSendPeminjamanNotification: ${error.message}`);
//     return res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan internal",
//       error: error.message,
//     });
//   }
// }
