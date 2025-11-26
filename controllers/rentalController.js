const Rental = require("../models/rentalModel");
const countController = require("./V2/countController");
const {
  publishConfig,
  publishCommand
} = require('../mqtt/mqttHelper')
const mqttHelper = require('../mqtt/mqttHelper')

exports.createRental = async (req, res) => {
  try {
    const {
      machineId,
      userId,
      awal_peminjaman,
      akhir_peminjaman
    } = req.body;
    const rental = await Rental.create({
      machineId,
      userId,
      awal_peminjaman,
      akhir_peminjaman
    });
    await countController.updateRentalCount();
    res.status(201).json({
      success: true,
      data: rental
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.getRentals = async (req, res) => {
  try {
    const rentals = await Rental.find().populate("machineId").populate("userId").sort({
      createdAt: -1
    });
    res.status(200).json({
      success: true,
      data: rentals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.getRentalByUserId = async (req, res) => {
  try {
    const {
      userId
    } = req.params;

    const rentals = await Rental.find({
        userId
      })
      .populate({
        path: "machineId",
        select: "name model description imageUrl"
      })
      .sort({
        createdAt: -1
      });

    if (!rentals.length) {
      return res.status(404).json({
        success: false,
        message: "No rentals found for this user"
      });
    }

    const result = rentals.map(rental => {
      const start = new Date(rental.awal_peminjaman);
      const end = new Date(rental.akhir_peminjaman);
      const oneDayMs = 1000 * 60 * 60 * 24;
      const days = Math.ceil(Math.abs(end - start) / oneDayMs);

      const mesin = rental.machineId ? {
        nama: rental.machineId.name,
        model: rental.machineId.model,
        deskripsi: rental.machineId.description,
        gambar: rental.machineId.imageUrl
      } : {
        nama: null,
        model: null,
        deskripsi: null,
        gambar: null
      };

      return {
        id: rental._id,
        waktuPinjam: {
          awal: rental.awal_peminjaman,
          akhir: rental.akhir_peminjaman,
          jumlahHari: days
        },
        mesin,
        status: rental.status,
        isStarted: rental.isStarted,
        isActivated: rental.isActivated,
        createdAt: rental.createdAt
      };
    });

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};


exports.getRentalById = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const rental = await Rental.findById(id)
      .populate({
        path: "userId",
        select: "email name role nim nip jurusan profile_picture"
      })
      .populate({
        path: "machineId",
        select: "name model description imageUrl"
      });

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Rental not found"
      });
    }

    const start = new Date(rental.awal_peminjaman);
    const end = new Date(rental.akhir_peminjaman);
    const oneDayMs = 1000 * 60 * 60 * 24;
    const days = Math.ceil(Math.abs(end - start) / oneDayMs);

    res.status(200).json({
      success: true,
      data: {
        id: rental._id,
        waktuPinjam: {
          awal: rental.awal_peminjaman,
          akhir: rental.akhir_peminjaman,
          jumlahHari: days
        },
        peminjam: {
          nama: rental.userId.name,
          email: rental.userId.email,
          role: rental.userId.role,
          nim: rental.userId.nim,
          nip: rental.userId.nip,
          jurusan: rental.userId.jurusan,
          profile_picture: rental.userId.profile_picture
        },
        mesin: {
          nama: rental.machineId.name,
          model: rental.machineId.model,
          deskripsi: rental.machineId.description,
          gambar: rental.machineId.imageUrl
        },
        status: rental.status,
        isStarted: rental.isStarted,
        isActivated: rental.isActivated
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.getRentalsByStatus = async (req, res) => {
  try {
    const {
      status
    } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required"
      });
    }

    const rentals = await Rental.find({
        status
      })
      .populate("machineId")
      .populate("userId")
      .sort({
        createdAt: -1
      });

    res.status(200).json({
      success: true,
      data: rentals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.updateRental = async (req, res) => {
  try {
    const {
      id
    } = req.params;
    const updates = req.body;
    const rental = await Rental.findByIdAndUpdate(id, updates, {
      new: true
    });
    if (!rental) return res.status(404).json({
      success: false,
      message: "Rental not found"
    });
    res.status(200).json({
      success: true,
      data: rental
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.deleteRental = async (req, res) => {
  try {
    const {
      id
    } = req.params;
    const deleted = await Rental.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({
      success: false,
      message: "Rental not found"
    });
    res.status(200).json({
      success: true,
      message: "Rental deleted"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.updateRentalStatus = async (req, res) => {
  const {
    id
  } = req.params;
  const {
    status
  } = req.body;

  const allowedStatuses = ["Disetujui", "Ditolak", "Pending"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status value"
    });
  }

  try {
    const rental = await Rental.findByIdAndUpdate(
      id, {
        status: status
      }, {
        new: true
      }
    ).populate("machineId").populate("userId");

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Rental not found"
      });
    }

    await countController.updateRentalCount();
    res.status(200).json({
      success: true,
      data: rental
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
// endpoint start rental
exports.startRental = async (req, res) => {
  try {
    const {
      id
    } = req.params;

    const rental = await Rental.findById(id)
      .populate('machineId')
      .populate('userId', 'name email');

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Rental not found"
      });
    }

    console.log('🔍 Rental data:', JSON.stringify({
      rentalId: rental._id.toString(),
      machineId: rental.machineId ? rental.machineId._id.toString() : 'NULL',
      machineName: rental.machineId ? rental.machineId.name : 'NULL',
      userId: rental.userId ? rental.userId.name : 'NULL',
      status: rental.status,
      isStarted: rental.isStarted,
      awalPeminjaman: rental.awal_peminjaman,
      akhirPeminjaman: rental.akhir_peminjaman
    }, null, 2));

    if (rental.isStarted) {
      return res.status(400).json({
        success: false,
        message: "Rental already started"
      });
    }

    if (rental.status !== "Disetujui") {
      return res.status(400).json({
        success: false,
        message: "Rental belum disetujui"
      });
    }

    if (!rental.machineId) {
      return res.status(400).json({
        success: false,
        message: "Rental tidak memiliki machine yang terdaftar"
      });
    }

    const now = new Date();
    const awalPeminjaman = new Date(rental.awal_peminjaman);
    const akhirPeminjaman = new Date(rental.akhir_peminjaman);

    const toleransiMulai = new Date(awalPeminjaman.getTime() - (15 * 60 * 1000));

    if (now < toleransiMulai) {
      return res.status(400).json({
        success: false,
        message: `Rental belum bisa dimulai. Waktu mulai: ${awalPeminjaman.toLocaleString('id-ID')}`
      });
    }

    if (now > akhirPeminjaman) {
      return res.status(400).json({
        success: false,
        message: "Waktu rental sudah berakhir"
      });
    }

    try {
      console.log(`📡 Sending rental config to ESP32 via MQTT...`);

      const machineIdStr = rental.machineId._id.toString();
      const rentalIdStr = rental._id.toString();

      // Gunakan mqttRentalHelper untuk kirim config
      const mqttResult = await mqttHelper.startRental(machineIdStr, rentalIdStr);

      console.log(`MQTT Result ${JSON.stringify({
        success: mqttResult.success,
        message: mqttResult.message,
        topic: mqttResult.topic,
        chipId: mqttResult.chipId
      })}`)

      // Log untuk monitoring
      console.log(`🎯 Rental started successfully:`, JSON.stringify({
        machineId: machineIdStr,
        rentalId: rentalIdStr,
        machineName: rental.machineId.name,
        userName: rental.userId.name,
        esp_chipId: rental.machineId.esp_address,
        mqtt_topic: mqttResult.topic
      }));

    } catch (mqttError) {
      console.error("❌ MQTT Error:", mqttError.message);
      console.warn('⚠️ Rental started but MQTT config failed. ESP32 might not receive config.');
    }

    rental.isStarted = true;
    rental.isActivated = true;
    rental.startTime = now;
    await rental.save();



    res.status(200).json({
      success: true,
      message: "Rental berhasil dimulai",
      data: {
        rentalId: rental._id,
        machineId: rental.machineId._id,
        machineName: rental.machineId.name,
        userName: rental.userId.name,
        esp_chipId: rental.machineId.esp_address,
        waktu_mulai_aktual: rental.startTime,
        sisa_waktu_menit: Math.max(0, Math.floor((akhirPeminjaman - now) / (1000 * 60))),
        mqtt_status: "Config sent to ESP32"
      }
    });

  } catch (error) {
    console.error('❌ startRental Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.extendRental = async (req, res) => {
  try {
    const {
      id
    } = req.params;
    const {
      extendMinutes
    } = req.body;

    console.log(`🔄 Extend rental request: ${id}, ${extendMinutes} minutes`);

    // Validasi input
    if (!extendMinutes) {
      return res.status(400).json({
        success: false,
        message: "extendMinutes is required"
      });
    }

    const rental = await Rental.findById(id).populate('machineId');

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Rental not found"
      });
    }

    if (!rental.isStarted) {
      return res.status(400).json({
        success: false,
        message: "Rental belum dimulai"
      });
    }

    // Validasi extend minutes
    const allowedMinutes = [5, 10, 15];
    if (!allowedMinutes.includes(parseInt(extendMinutes))) {
      return res.status(400).json({
        success: false,
        message: "Durasi perpanjangan tidak valid. Pilih 5, 10, atau 15 menit"
      });
    }

    // Debug: Cek semua field waktu
    console.log('📅 Rental time details:');
    console.log('   - awal_peminjaman:', rental.awal_peminjaman);
    console.log('   - akhir_peminjaman:', rental.akhir_peminjaman);
    console.log('   - isStarted:', rental.isStarted);
    console.log('   - startedAt:', rental.startedAt);

    // Cari sumber waktu yang valid untuk perhitungan
    let baseTime;

    // Priority 1: Gunakan startedAt jika ada dan valid
    if (rental.startedAt && !isNaN(new Date(rental.startedAt).getTime())) {
      baseTime = new Date(rental.startedAt);
      console.log('🔄 Using startedAt as base time:', baseTime);
    }
    // Priority 2: Gunakan awal_peminjaman jika valid
    else if (rental.awal_peminjaman && !isNaN(new Date(rental.awal_peminjaman).getTime())) {
      baseTime = new Date(rental.awal_peminjaman);
      console.log('🔄 Using awal_peminjaman as base time:', baseTime);
    }
    // Priority 3: Gunakan createdAt sebagai fallback
    else {
      baseTime = new Date(rental.createdAt);
      console.log('🔄 Using createdAt as base time:', baseTime);
    }

    // Tentukan currentEndTime
    let currentEndTime;

    if (rental.akhir_peminjaman && !isNaN(new Date(rental.akhir_peminjaman).getTime())) {
      // Jika akhir_peminjaman valid, gunakan itu
      currentEndTime = new Date(rental.akhir_peminjaman);
      console.log('🔄 Using existing akhir_peminjaman:', currentEndTime);
    } else {
      // Jika akhir_peminjaman invalid/undefined, hitung dari baseTime + durasi default
      const defaultDuration = 60; // 60 menit default
      currentEndTime = new Date(baseTime.getTime() + (defaultDuration * 60 * 1000));
      console.log('🔄 Created new end time from base time:', currentEndTime);

      // Update rental dengan end time yang baru
      rental.akhir_peminjaman = currentEndTime;
    }

    // Extend waktu akhir peminjaman
    const extendMs = parseInt(extendMinutes) * 60 * 1000;
    const newEndTime = new Date(currentEndTime.getTime() + extendMs);

    console.log('🕒 Time calculation:');
    console.log('   - Base time:', baseTime);
    console.log('   - Current end:', currentEndTime);
    console.log('   - Extend minutes:', extendMinutes);
    console.log('   - New end:', newEndTime);

    // Update rental data
    rental.akhir_peminjaman = newEndTime;

    // Update extendedMinutes counter
    rental.extendedMinutes = (rental.extendedMinutes || 0) + parseInt(extendMinutes);

    // Tambahkan log extend
    rental.extendLogs = rental.extendLogs || [];
    rental.extendLogs.push({
      extendedAt: new Date(),
      minutes: parseInt(extendMinutes),
      oldEndTime: currentEndTime,
      newEndTime: newEndTime,
      note: 'Auto-corrected missing akhir_peminjaman'
    });

    // Simpan perubahan
    await rental.save();
    console.log('✅ Rental updated successfully');

    // Kirim notifikasi ke ESP (optional)
    if (rental.machineId && rental.machineId.esp_address) {
      try {
        await mqttHelper.startRental(
          rental.machineId._id.toString(),
          rental._id.toString()
        );
        console.log(`🔄 Extended rental config sent to ESP: ${rental.machineId.esp_address}`);
      } catch (mqttError) {
        console.error("MQTT Extend Error:", mqttError.message);
        // Jangan return error, karena extend sudah berhasil di database
      }
    }

    res.status(200).json({
      success: true,
      message: `Rental berhasil diperpanjang ${extendMinutes} menit`,
      data: {
        rentalId: rental._id,
        machineName: rental.machineId ?.name || 'Unknown Machine',
        oldEndTime: currentEndTime,
        newEndTime: newEndTime,
        extendedMinutes: parseInt(extendMinutes),
        totalExtended: rental.extendedMinutes,
        note: rental.akhir_peminjaman ? undefined : 'End time was automatically set'
      }
    });

  } catch (error) {
    console.error('❌ Extend rental error:', error);

    // Handle specific MongoDB validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: "Data validation failed",
        details: error.message
      });
    }

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: "Invalid data format",
        details: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ✅ END RENTAL (Yang sudah ada, tapi kita optimize)
exports.endRental = async (req, res) => {
  try {
    const {
      id
    } = req.params;
    const rental = await Rental.findById(id).populate('machineId');

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Rental not found"
      });
    }

    if (!rental.isStarted) {
      return res.status(400).json({
        success: false,
        message: "Rental belum dimulai"
      });
    }

    const now = new Date();
    const waktuMulai = rental.startTime || new Date(rental.awal_peminjaman);

    const durasiAktualMs = now - waktuMulai;
    const durasiAktualMenit = Math.floor(durasiAktualMs / (1000 * 60));

    // Update rental
    rental.isActivated = true;
    rental.isStarted = false;
    rental.endTime = now;
    rental.durasi_aktual_menit = durasiAktualMenit;
    await rental.save();

    if (rental.machineId) {
      try {
        await mqttHelper.stopRental(
          rental.machineId._id.toString(),
          rental._id.toString()
        );
        console.log(`✅ STOP command sent to ESP: ${rental.machineId.esp_address}`);
      } catch (mqttError) {
        console.error("❌ MQTT Stop Error:", mqttError.message);
      }
    } else {
      console.log("⚠️  No ESP address found, machine will continue running");
    }


    await rental.populate('userId', 'name email');
    await rental.populate('machineId', 'name type model');

    res.status(200).json({
      success: true,
      message: "Rental berhasil diakhiri",
      data: {
        ...rental.toObject(),
        durasi_aktual: {
          jam: Math.floor(durasiAktualMenit / 60),
          menit: durasiAktualMenit % 60,
          total_menit: durasiAktualMenit
        }
      }
    });

  } catch (error) {
    console.error('❌ End rental error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

exports.emergencyShutdown = async (req, res) => {
  try {
    const {
      rentalId
    } = req.params;
    const {
      reason
    } = req.body;

    // Cari rental aktif
    const rental = await Rental.findOne({
      _id: rentalId,
      status: 'Disetujui',
      isStarted: true
    }).populate('machineId');

    if (!rental) {
      return res.status(404).json({
        error: 'Active rental not found'
      });
    }

    // Update status rental & mesin
    rental.status = 'Dihentikan';
    rental.shutdownReason = reason || 'Emergency shutdown by system';
    rental.shutdownAt = new Date();
    await rental.save();

    // Update status mesin
    await Machine.findByIdAndUpdate(rental.machineId, {
      $set: {
        'realTimeStatus.status': 'critical',
        'realTimeStatus.lastUpdate': new Date()
      }
    });

    // Kirim perintah shutdown ke ESP (via MQTT)
    await mqttRentalHelper.stopRental(rental.machineId._id, rentalId);

    // Kirim notifikasi ke user
    await sendNotification(
      rental.userId,
      '🚨 EMERGENCY SHUTDOWN',
      `Mesin ${rental.machineId.name} dihentikan karena: ${reason}`, {
        rentalId: rental._id.toString(),
        type: 'emergency_shutdown',
        machineId: rental.machineId._id.toString()
      }
    );

    res.json({
      success: true,
      message: 'Emergency shutdown executed',
      data: rental
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

exports.checkSystemDelay = async (req, res) => {
  try {
    const {
      machineId
    } = req.params;

    // Test timing dari ESP ke MongoDB ke Response
    const testStart = Date.now();

    // Simpan test data
    const testSensor = await SensorV2.create({
      machineId,
      sensorType: 'delay_test',
      value: 99.99,
      unit: 'ms',
      deviceTimestamp: Date.now(),
      waktu: new Date()
    });

    const dbWriteTime = Date.now() - testStart;

    // Query data terbaru
    const latestData = await SensorV2.findOne({
      machineId,
      sensorType: 'delay_test'
    }).sort({
      waktu: -1
    });

    const totalDelay = Date.now() - testStart;

    res.json({
      success: true,
      data: {
        testId: testSensor._id,
        dbWriteTime: `${dbWriteTime}ms`,
        totalSystemDelay: `${totalDelay}ms`,
        timestamp: new Date().toISOString(),
        recommendation: totalDelay > 1000 ? 'High latency detected' : 'System responsive'
      }
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

exports.exportSensorDataWithDelay = async (req, res) => {
  try {
    const {
      machineId,
      startDate,
      endDate
    } = req.query;

    // Include delay information in export
    const sensorData = await SensorV2.find({
      machineId,
      waktu: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    }).populate('machineId').sort({
      waktu: -1
    });

    // Calculate processing delays for each record
    const dataWithDelay = sensorData.map(record => ({
      Timestamp: record.waktu,
      'ID Mesin': record.machineId,
      Sensor: record.sensorType,
      Value: record.value,
      Unit: record.unit,
      'Processing Delay (ms)': record.deviceTimestamp ?
        (new Date(record.waktu) - new Date(record.deviceTimestamp)) : 'N/A',
      'Data Quality': record.deviceTimestamp &&
        (new Date(record.waktu) - new Date(record.deviceTimestamp)) < 5000 ? 'Good' : 'Delayed'
    }));

    // Export ke CSV (pakai function yang sudah ada)
    const csv = convertToCsv(dataWithDelay);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      `attachment; filename=sensor-data-with-delay-${machineId}.csv`);
    res.send(csv);

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};


// const emergencyFixRentalDates = async () => {
//   try {
//     console.log('🚨 Starting emergency fix for rental dates...');

//     // Cari semua rental yang akhir_peminjaman-nya undefined, null, atau invalid
//     const problematicRentals = await Rental.find({
//       $or: [
//         { akhir_peminjaman: { $exists: false } },
//         { akhir_peminjaman: null },
//         { akhir_peminjaman: { $type: 'undefined' } },
//         { akhir_peminjaman: { $eq: undefined } }
//       ]
//     }).populate('machineId');

//     console.log(`🔧 Found ${problematicRentals.length} problematic rentals`);

//     let fixedCount = 0;

//     for (let rental of problematicRentals) {
//       try {
//         console.log(`\n🔧 Fixing rental: ${rental._id}`);
//         console.log('   - awal_peminjaman:', rental.awal_peminjaman);
//         console.log('   - akhir_peminjaman:', rental.akhir_peminjaman);
//         console.log('   - startedAt:', rental.startedAt);
//         console.log('   - createdAt:', rental.createdAt);

//         let baseTime;
//         let defaultDuration = 60; // 60 menit default

//         // Tentukan base time
//         if (rental.startedAt && !isNaN(new Date(rental.startedAt).getTime())) {
//           baseTime = new Date(rental.startedAt);
//         } else if (rental.awal_peminjaman && !isNaN(new Date(rental.awal_peminjaman).getTime())) {
//           baseTime = new Date(rental.awal_peminjaman);
//         } else {
//           baseTime = new Date(rental.createdAt);
//         }

//         // Hitung end time baru
//         const newEndTime = new Date(baseTime.getTime() + (defaultDuration * 60 * 1000));

//         // Update rental
//         rental.akhir_peminjaman = newEndTime;
//         rental.extendLogs = rental.extendLogs || [];
//         rental.extendLogs.push({
//           extendedAt: new Date(),
//           minutes: 0,
//           oldEndTime: null,
//           newEndTime: newEndTime,
//           note: 'EMERGENCY FIX: Missing akhir_peminjaman'
//         });

//         await rental.save();
//         fixedCount++;
//         console.log(`   ✅ Fixed - new end time: ${newEndTime}`);

//       } catch (rentalError) {
//         console.error(`   ❌ Error fixing rental ${rental._id}:`, rentalError.message);
//       }
//     }

//     console.log(`\n🎉 Emergency fix completed! Fixed ${fixedCount} rentals`);

//   } catch (error) {
//     console.error('💥 Emergency fix failed:', error);
//   }
// };

// Jalankan script ini sekali
// extend rental , 5 menit ,15 menit, 30 menit -> hanya 3 opsi ini