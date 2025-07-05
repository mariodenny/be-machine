// controllers/machineStatusController.js

const { Cnc, Laser, Printing } = require("../models/peminjamanModel");

const getModelByType = (type) => {
  switch (type.toLowerCase()) {
    case "cnc":
    case "cnc milling":
      return Cnc;
    case "laser":
    case "laser cutting":
      return Laser;
    case "printing":
    case "3d printing":
      return Printing;
    default:
      throw new Error(`Invalid machine type: ${type}`);
  }
};

const getMachineStatus = async (req, res) => {
  const { type } = req.params;

  try {
    const Model = getModelByType(type);

    // Cari peminjaman yang sedang aktif (hanya cek isStarted)
    const activePeminjaman = await Model.findOne({
      status: "Disetujui",
      isStarted: true,
      isActivated: true,
    }).populate("user", "username email");

    // Jika tidak ada peminjaman aktif
    if (!activePeminjaman) {
      return res.status(200).json({
        success: true,
        data: {
          isStarted: false,
          machineInfo: {
            type: type,
            status: "Tidak Aktif",
            currentUser: null,
          },
        },
      });
    }

    // Format response data
    const responseData = {
      isStarted: true,
      machineInfo: {
        type: type,
        status: "Aktif",
        currentUser: {
          id: activePeminjaman._id,
          nama_pemohon: activePeminjaman.nama_pemohon,
          tanggal_peminjaman: activePeminjaman.tanggal_peminjaman,
          awal_peminjaman: activePeminjaman.awal_peminjaman,
          akhir_peminjaman: activePeminjaman.akhir_peminjaman,
          tipe_pengguna: activePeminjaman.tipe_pengguna,
        },
      },
    };

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("Error getting machine status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get machine status",
      error: error.message,
    });
  }
};

module.exports = {
  getMachineStatus,
};
