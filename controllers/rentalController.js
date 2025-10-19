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
    const { id } = req.params;
    const { extendMinutes } = req.body; // 5, 10, 15 menit

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

    if (rental.isActivated) {
      return res.status(400).json({ 
        success: false, 
        message: "Rental sudah berakhir" 
      });
    }

    // Validasi extend minutes
    const allowedMinutes = [5, 10, 15];
    if (!allowedMinutes.includes(extendMinutes)) {
      return res.status(400).json({ 
        success: false, 
        message: "Durasi perpanjangan tidak valid. Pilih 5, 10, atau 15 menit" 
      });
    }

    // Extend waktu akhir peminjaman
    const currentEndTime = new Date(rental.akhir_peminjaman);
    const newEndTime = new Date(currentEndTime.getTime() + (extendMinutes * 60 * 1000));
    
    rental.akhir_peminjaman = newEndTime;
    await rental.save();

    // Kirim notifikasi ke ESP (optional)
    if (rental.machineId && rental.machineId.esp_address) {
      try {
        // Kirim config ulang dengan waktu extended
        await mqttHelper.startRental(
          rental.machineId._id.toString(), 
          rental._id.toString()
        );
        console.log(`🔄 Extended rental config sent to ESP: ${rental.machineId.esp_address}`);
      } catch (mqttError) {
        console.error("MQTT Extend Error:", mqttError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: `Rental berhasil diperpanjang ${extendMinutes} menit`,
      data: {
        rentalId: rental._id,
        machineName: rental.machineId.name,
        newEndTime: newEndTime,
        extendedMinutes: extendMinutes,
        totalExtended: rental.extendedMinutes || 0 + extendMinutes
      }
    });

  } catch (error) {
    console.error('❌ Extend rental error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// ✅ END RENTAL (Yang sudah ada, tapi kita optimize)
exports.endRental = async (req, res) => {
  try {
    const { id } = req.params;
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

    if (rental.isActivated) {
      return res.status(400).json({ 
        success: false, 
        message: "Rental sudah berakhir" 
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

    if (rental.machineId && rental.machineId.esp_address) {
      try {
        await mqttHelper.stopRental(
          rental.machineId._id.toString(), 
          rental._id.toString()
        );
        console.log(`🛑 STOP command sent to ESP: ${rental.machineId.esp_address}`);
      } catch (mqttError) {
        console.error("MQTT Stop Error:", mqttError.message);
      }
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

// extend rental , 5 menit ,15 menit, 30 menit -> hanya 3 opsi ini