const Rental = require("../models/rentalModel");
const countController = require("./V2/countController");
<<<<<<< HEAD
const {publishConfig, publishCommand} = require('../mqtt/mqttHelper')
const mqttHelper = require('../mqtt/mqttHelper')
=======
const { publishConfig, publishCommand } = require('../mqtt/mqttHelper')
>>>>>>> 7e3e1736837111624935078ff035df990a7f4d3a

exports.createRental = async (req, res) => {
  try {
    const { machineId, userId, awal_peminjaman, akhir_peminjaman } = req.body;
    const rental = await Rental.create({ machineId, userId, awal_peminjaman, akhir_peminjaman });
    await countController.updateRentalCount();
    res.status(201).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getRentals = async (req, res) => {
  try {
    const rentals = await Rental.find().populate("machineId").populate("userId").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: rentals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getRentalByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const rentals = await Rental.find({ userId })
      .populate({
        path: "machineId",
        select: "name model description imageUrl"
      })
      .sort({ createdAt: -1 });

    if (!rentals.length) {
      return res.status(404).json({ success: false, message: "No rentals found for this user" });
    }

    const result = rentals.map(rental => {
      const start = new Date(rental.awal_peminjaman);
      const end = new Date(rental.akhir_peminjaman);
      const oneDayMs = 1000 * 60 * 60 * 24;
      const days = Math.ceil(Math.abs(end - start) / oneDayMs);

      const mesin = rental.machineId
        ? {
          nama: rental.machineId.name,
          model: rental.machineId.model,
          deskripsi: rental.machineId.description,
          gambar: rental.machineId.imageUrl
        }
        : {
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

    res.status(200).json({ success: true, data: result });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};


exports.getRentalById = async (req, res) => {
  try {
    const { id } = req.params;

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
      return res.status(404).json({ success: false, message: "Rental not found" });
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
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getRentalsByStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const rentals = await Rental.find({ status })
      .populate("machineId")
      .populate("userId")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: rentals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateRental = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const rental = await Rental.findByIdAndUpdate(id, updates, { new: true });
    if (!rental) return res.status(404).json({ success: false, message: "Rental not found" });
    res.status(200).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteRental = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Rental.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Rental not found" });
    res.status(200).json({ success: true, message: "Rental deleted" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateRentalStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ["Disetujui", "Ditolak", "Pending"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status value" });
  }

  try {
    const rental = await Rental.findByIdAndUpdate(
      id,
      { status: status },
      { new: true }
    ).populate("machineId").populate("userId");

    if (!rental) {
      return res.status(404).json({ success: false, message: "Rental not found" });
    }

    await countController.updateRentalCount();
    res.status(200).json({ success: true, data: rental });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.startRental = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Populate dulu saat find
    const rental = await Rental.findById(id)
      .populate('machineId')
      .populate('userId', 'name email');

    if (!rental) {
      return res.status(404).json({ 
        success: false, 
        message: "Rental not found" 
      });
    }

    // Debug log untuk cek data
    console.log('🔍 Rental data:', {
      id: rental._id,
      machineId: rental.machineId,
      userId: rental.userId,
      status: rental.status
    });

    if (rental.isStarted) {
      return res.status(400).json({ 
        success: false, 
        message: "Rental already started" 
      });
    }

    // Validasi apakah rental sudah disetujui
    if (rental.status !== "Disetujui") {
      return res.status(400).json({ 
        success: false, 
        message: "Rental belum disetujui" 
      });
    }

    // Cek apakah ada machineId
    if (!rental.machineId) {
      return res.status(400).json({ 
        success: false, 
        message: "Rental tidak memiliki machine yang terdaftar" 
      });
    }

    // Validasi waktu rental
    const now = new Date();
    const awalPeminjaman = new Date(rental.awal_peminjaman);
    const akhirPeminjaman = new Date(rental.akhir_peminjaman);

    // Toleransi 15 menit sebelum waktu mulai
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

    // Update rental dengan waktu aktual mulai
    rental.isStarted = true;
    rental.isActivated = true;
    rental.startTime = now;
    await rental.save();

    // 🚀 Kirim config ke ESP32 via MQTT menggunakan mqttRentalHelper
    try {
      console.log(`📡 Sending rental config to ESP32 via MQTT...`);
      
      const machineIdStr = rental.machineId._id.toString();
      const rentalIdStr = rental._id.toString();
      
      // Gunakan mqttRentalHelper untuk kirim config
      const mqttResult = await mqttHelper.startRental(machineIdStr, rentalIdStr);
      
      console.log('✅ MQTT Config sent successfully:', mqttResult);
      
      // Log untuk monitoring
      console.log(`🎯 Rental started:`, {
        machineId: machineIdStr,
        rentalId: rentalIdStr,
        machineName: rental.machineId.name || 'Unknown',
        userName: rental.userId.name || 'Unknown',
        esp_address: rental.machineId.esp_address || 'Not configured'
      });
      
    } catch (mqttError) {
      console.error("❌ MQTT Error:", mqttError.message);
      
      // Tetap lanjutkan rental tapi beri warning
      console.warn('⚠️ Rental started but MQTT config failed. ESP32 might not receive config.');
      
      // Optional: Revert rental status jika MQTT critical
      // rental.isStarted = false;
      // rental.startTime = null;
      // await rental.save();
      // return res.status(500).json({
      //   success: false,
      //   message: "Rental gagal dimulai: MQTT connection error"
      // });
    }

    // Return response dengan data yang sudah di-populated
    res.status(200).json({ 
      success: true, 
      message: "Rental berhasil dimulai", 
      data: {
        rentalId: rental._id,
        machineId: rental.machineId._id,
        machineName: rental.machineId.name,
        userName: rental.userId.name,
        waktu_mulai_aktual: rental.startTime,
        awal_peminjaman: awalPeminjaman,
        akhir_peminjaman: akhirPeminjaman,
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

exports.endRental = async (req, res) => {
  try {
    const { id } = req.params;
    const rental = await Rental.findById(id).populate('machineId');

    if (!rental) return res.status(404).json({ success: false, message: "Rental not found" });

    if (!rental.isStarted) return res.status(400).json({ success: false, message: "Rental belum dimulai" });

    if (rental.isActivated) return res.status(400).json({ success: false, message: "Rental sudah berakhir" });

    const now = new Date();
    const waktuMulai = rental.startTime || new Date(rental.awal_peminjaman);

    // Hitung durasi aktual
    const durasiAktualMs = now - waktuMulai;
    const durasiAktualJam = durasiAktualMs / (1000 * 60 * 60);
    const durasiAktualMenit = Math.floor(durasiAktualMs / (1000 * 60));

    // Update rental
    rental.isActivated = true;
    rental.endTime = now; // Pakai field yang sudah ada
    rental.durasi_aktual_menit = durasiAktualMenit;
    await rental.save();

    // Kirim command STOP ke ESP32 via MQTT
    if (rental.machineId && rental.machineId.esp_address) {
      try {
        publishCommand(rental.machineId.esp_address, "stop");
        console.log(`MQTT STOP command sent to ESP32: ${rental.machineId.esp_address}`);
      } catch (mqttError) {
        console.error("MQTT Error:", mqttError.message);
      }
    }

    // Populate data untuk response
    await rental.populate('userId', 'name email');
    await rental.populate('machineId', 'name type model');

    res.status(200).json({
      success: true,
      message: "Rental berhasil diakhiri",
      data: {
        ...rental.toObject(),
        durasi_aktual: {
          jam: Math.floor(durasiAktualJam),
          menit: durasiAktualMenit % 60,
          total_menit: durasiAktualMenit
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};