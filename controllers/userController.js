// userController.js

const { checkAvailability } = require("../middleware/checkAvailability");
const axios = require("axios"); // Untuk mengirim request ke ESP32
const { google } = require("googleapis");
const { Readable } = require("stream");
const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
const SCOPE = ["https://www.googleapis.com/auth/drive"];
const {
  sendAdminNotification,
} = require("../controllers/notificationController");

const multer = require("multer");

// Set up Google Drive API
const oauth2Client = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL || "",
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/drive.file"]
);

const drive = google.drive({ version: "v3", auth: oauth2Client });

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB limit
  fileFilter: (req, file, cb) => {
    // Allowed MIME types
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    // Check MIME type and extension
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    if (
      allowedMimeTypes.includes(file.mimetype) ||
      ["pdf", "docx", "jpg", "jpeg", "png"].includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only images, PDFs, and DOCX are allowed.")
      );
    }
  },
});

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

const uploadFileToDrive = async (fileBuffer, fileName, mimeType) => {
  try {
    const fileStream = bufferToStream(fileBuffer);

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: mimeType,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: mimeType,
        body: fileStream,
      },
    });

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const file = await drive.files.get({
      fileId: response.data.id,
      fields: "webViewLink",
    });

    return file.data.webViewLink;
  } catch (error) {
    console.error("Error uploading file to Google Drive:", error);
    throw error;
  }
};

function logWithTimestamp(message, data = null) {
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
  if (data) {
    console.log(`[${formattedTime}] : ${message}`, data);
  } else {
    console.log(`[${formattedTime}] : ${message}`);
  }
}

const getModelAndMesinName = (type) => {
  switch (type) {
    case "cnc":
      return { Model: Cnc, mesinName: "Cnc Milling" };
    case "laser":
      return { Model: Laser, mesinName: "Laser Cutting" };
    case "printing":
      return { Model: Printing, mesinName: "3D Printing" };
    default:
      throw new Error("Invalid type parameter");
  }
};

// Pengguna //

const peminjamanHandler = async (req, res) => {
  try {
    const { type } = req.params;

    if (!["cnc", "laser", "printing"].includes(type)) {
      return res.status(400).json({ message: "Invalid machine name" });
    }

    // Handle file size limit error
    if (req.error && req.error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Ukuran file melebihi batas maksimum (2MB)",
      });
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(req.body.email)) {
      return res.status(400).json({
        success: false,
        message: "Format email tidak valid",
      });
    }

    // Validasi basic requirements
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File wajib diunggah",
      });
    }

    // Validasi tipe pengguna
    if (!req.body.tipe_pengguna) {
      return res.status(400).json({
        success: false,
        message: "Tipe pengguna wajib diisi",
      });
    }

    // Validasi nomor identitas berdasarkan tipe pengguna
    if (!req.body.nomor_identitas) {
      return res.status(400).json({
        success: false,
        message: "Nomor identitas wajib diisi",
      });
    }

    // Validasi format nomor identitas
    let isValidIdentitas = false;
    switch (req.body.tipe_pengguna) {
      case "Mahasiswa":
        isValidIdentitas = /^[0-9]{8,}$/.test(req.body.nomor_identitas);
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Format NIM tidak valid",
          });
        }
        break;
      case "Pekerja":
        isValidIdentitas = /^[0-9]{18,}$/.test(req.body.nomor_identitas);
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Format NIP tidak valid",
          });
        }
        break;
      case "PKL":
      case "Eksternal":
        if (!req.body.asal_instansi) {
          return res.status(400).json({
            success: false,
            message: "Asal instansi wajib diisi untuk pengguna external",
          });
        }
        isValidIdentitas = req.body.nomor_identitas.length >= 3;
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Identitas harus memiliki minimal 3 karakter",
          });
        }
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Tipe pengguna tidak valid",
        });
    }

    const { Model, mesinName } = getModelAndMesinName(type);

    let {
      email,
      nama_pemohon,
      tanggal_peminjaman,
      awal_peminjaman,
      akhir_peminjaman,
      jumlah,
      jurusan,
      detail_keperluan,
      program_studi,
      kategori,
      desain_benda,
      tipe_pengguna,
      nomor_identitas,
      asal_instansi,
    } = req.body;
    // const { userId, userName } = req.username;
    const { userId, userName } = req.user;

    // Validasi jika diperlukan
    if (
      (kategori === "Praktek" || kategori === "Proyek Mata Kuliah") &&
      (!detail_keperluan || detail_keperluan.trim().length === 0)
    ) {
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Detail keperluan wajib diisi",
      });
    }

    // Konversi jumlah ke number
    jumlah = Number(jumlah);

    // Tambahkan validasi untuk memastikan jumlah adalah bilangan bulat
    if (!Number.isInteger(jumlah) || jumlah <= 0) {
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Jumlah harus berupa bilangan bulat positif",
      });
    }

    let convertedAwalPeminjaman;
    let convertedAkhirPeminjaman;

    try {
      // Convert awal_peminjaman
      if (!awal_peminjaman) {
        throw new Error("Waktu awal peminjaman harus diisi");
      }
      convertedAwalPeminjaman = convertTimeStringToDate(awal_peminjaman);

      // Convert akhir_peminjaman
      if (!akhir_peminjaman) {
        throw new Error("Waktu akhir peminjaman harus diisi");
      }
      convertedAkhirPeminjaman = convertTimeStringToDate(akhir_peminjaman);

      // Validasi logika waktu
      if (convertedAkhirPeminjaman <= convertedAwalPeminjaman) {
        throw new Error(
          "Waktu akhir peminjaman harus lebih besar dari waktu awal"
        );
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: error.message || "Format waktu tidak valid",
      });
    }

    // Tentukan alamat_esp berdasarkan nama_mesin
    let alamat_esp;
    switch (mesinName.toLowerCase()) {
      case "cnc milling":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/cnc/buttonPeminjaman";
        break;
      case "laser cutting":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/laser/buttonPeminjaman";
        break;
      case "3d printing":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/printing/buttonPeminjaman";
        break;
      default:
        return res.status(400).json({ message: "Invalid machine name" });
    }

    // TRY YANG PERTAMA
    // try {
    logWithTimestamp("Checking availability for the selected time slot...");

    const isAvailable = await checkAvailability(
      Model,
      tanggal_peminjaman,
      convertedAwalPeminjaman,
      convertedAkhirPeminjaman
    );

    // if (!isAvailable) {
    //   logWithTimestamp("Selected time slot is not available.");
    //   return res.status(409).json({
    //     success: false,
    //     message: "Waktu yang dipilih tidak tersedia. Silakan pilih waktu lain.",
    //   });
    // }

    // Tambahkan logging detail
    logWithTimestamp(
      `Availability check result: ${JSON.stringify(isAvailable, null, 2)}`
    );

    if (!isAvailable.available) {
      logWithTimestamp("Selected time slot is not available.");
      return res.status(409).json({
        success: false,
        message: isAvailable.reason,
      });
    }

    logWithTimestamp(
      "Time slot is available, proceeding with saving peminjaman..."
    );

    const fileLink = await uploadFileToDrive(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    logWithTimestamp("File uploaded successfully, saving peminjaman...");

    // const fileLink = await uploadFileToDrive(req.file.buffer, req.file.originalname);
    const peminjamanEntry = await Model.create({
      nama_mesin: mesinName,
      alamat_esp, // Menyimpan alamat_esp yang telah ditentukan
      email,
      nama_pemohon,
      tipe_pengguna,
      nomor_identitas,
      asal_instansi: tipe_pengguna === "external" ? asal_instansi : undefined,
      tanggal_peminjaman,
      awal_peminjaman: convertedAwalPeminjaman,
      akhir_peminjaman: convertedAkhirPeminjaman,
      // tanggal_peminjaman,
      // awal_peminjaman,
      // akhir_peminjaman,
      jumlah,
      // jurusan: tipe_pengguna === 'mahasiswa' ? jurusan : undefined,
      // program_studi: tipe_pengguna === 'mahasiswa' ? program_studi : undefined,
      jurusan,
      detail_keperluan,
      program_studi,
      kategori,
      desain_benda: fileLink, // Simpan link file yang diunggah
      status: "Menunggu",
      user: userId,
      isStarted: false,
    });

    // Kirim notifikasi ke admin setelah peminjaman dibuat
    const notificationResult = await sendAdminNotification(
      peminjamanEntry,
      type
    );

    if (!notificationResult.success) {
      logWithTimestamp("Failed to send admin notifications");
    }

    res.status(201).json({
      success: true,
      statusCode: res.statusCode,
      message: "Uploaded!",
      data: {
        nama_mesin: peminjamanEntry.nama_mesin,
        alamat_esp, // Sertakan alamat_esp dalam respons jika diperlukan
        email,
        nama_pemohon,
        tipe_pengguna: peminjamanEntry.tipe_pengguna,
        nomor_identitas: peminjamanEntry.nomor_identitas,
        asal_instansi: peminjamanEntry.asal_instansi,
        tanggal_peminjaman: peminjamanEntry.tanggal_peminjaman,
        awal_peminjaman: peminjamanEntry.awal_peminjaman,
        akhir_peminjaman: peminjamanEntry.akhir_peminjaman,
        // tanggal_peminjaman,
        // awal_peminjaman,
        // akhir_peminjaman,

        jumlah,
        jurusan,
        detail_keperluan,
        program_studi,
        kategori,
        desain_benda: fileLink,
        status: peminjamanEntry.status,
        waktu: peminjamanEntry.waktu,
        user: userName,
        isStarted: peminjamanEntry.isStarted,
      },
    });
  } catch (err) {
    console.error(err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Ukuran file melebihi batas maksimum (2MB)",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error saat membuat peminjaman atau mengunggah file",
      error: err.message,
    });
  }
};

// Helper function to convert time string to a Date object
function convertTimeStringToDate(timeString) {
  if (!timeString) return null;

  try {
    // Handle ISO string format
    if (timeString.includes("T")) {
      return new Date(timeString);
    }

    // Handle 12-hour format (10:00 AM/PM)
    const [time, modifier] = timeString.split(" ");
    let [hours, minutes] = time.split(":");

    hours = parseInt(hours, 10);
    minutes = parseInt(minutes, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      throw new Error("Invalid time format");
    }

    if (modifier === "PM" && hours < 12) {
      hours += 12;
    }
    if (modifier === "AM" && hours === 12) {
      hours = 0;
    }

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  } catch (error) {
    throw new Error("Invalid time format");
  }
}

// const getPeminjamanAllHandler = async (req, res) => {
//   try {
//     const userId = req.user.userId;
//     const userRole = req.user.role;

//     console.log("Starting peminjaman fetch for:", {
//       userId,
//       email: req.user.email,
//       role: userRole,
//       timestamp: new Date().toISOString(),
//     });

//     let cncPeminjaman = [];
//     let laserPeminjaman = [];
//     let printingPeminjaman = [];

//     // Ambil data dengan logging per tipe mesin
//     if (userRole === "admin") {
//       cncPeminjaman = await Cnc.find().populate("user", "username email");
//       console.log(`Found ${cncPeminjaman.length} CNC peminjaman`);

//       laserPeminjaman = await Laser.find().populate("user", "username email");
//       console.log(`Found ${laserPeminjaman.length} Laser peminjaman`);

//       printingPeminjaman = await Printing.find().populate(
//         "user",
//         "username email"
//       );
//       console.log(`Found ${printingPeminjaman.length} Printing peminjaman`);
//     } else {
//       cncPeminjaman = await Cnc.find({ user: userId }).populate(
//         "user",
//         "username email"
//       );
//       laserPeminjaman = await Laser.find({ user: userId }).populate(
//         "user",
//         "username email"
//       );
//       printingPeminjaman = await Printing.find({ user: userId }).populate(
//         "user",
//         "username email"
//       );
//     }

//     // Gabungkan dengan detail jumlah per status
//     let peminjamanForm = [
//       ...cncPeminjaman.map((item) => ({ ...item.toObject(), type: "cnc" })),
//       ...laserPeminjaman.map((item) => ({ ...item.toObject(), type: "laser" })),
//       ...printingPeminjaman.map((item) => ({
//         ...item.toObject(),
//         type: "printing",
//       })),
//     ];

//     // Hitung statistik
//     const stats = {
//       total: peminjamanForm.length,
//       byStatus: {
//         Menunggu: peminjamanForm.filter((p) => p.status === "Menunggu").length,
//         Disetujui: peminjamanForm.filter((p) => p.status === "Disetujui")
//           .length,
//         Ditolak: peminjamanForm.filter((p) => p.status === "Ditolak").length,
//       },
//       byType: {
//         cnc: cncPeminjaman.length,
//         laser: laserPeminjaman.length,
//         printing: printingPeminjaman.length,
//       },
//     };

//     console.log("Peminjaman statistics:", stats);

//     // Sort dengan logging
//     peminjamanForm.sort((a, b) => {
//       const statusPriority = {
//         Menunggu: 0,
//         Disetujui: 1,
//         Ditolak: 2,
//       };

//       const statusDiff = statusPriority[a.status] - statusPriority[b.status];
//       if (statusDiff !== 0) return statusDiff;

//       return new Date(b.tanggal_peminjaman) - new Date(a.tanggal_peminjaman);
//     });

//     // Format response dengan informasi tambahan
//     const responseData = peminjamanForm.map((item) => ({
//       id: item._id,
//       type: item.type,
//       nama_pemohon: item.nama_pemohon,
//       nama_mesin: item.nama_mesin,
//       alamat_esp: item.alamat_esp,
//       tanggal_peminjaman: item.tanggal_peminjaman,
//       awal_peminjaman: item.awal_peminjaman,
//       akhir_peminjaman: item.akhir_peminjaman,
//       status: item.status,
//       waktu: item.waktu,
//       isStarted: item.isStarted,
//       user: item.user
//         ? {
//             id: item.user._id,
//             username: item.user.username,
//             email: item.user.email,
//           }
//         : null,
//       created_at: item.createdAt,
//       updated_at: item.updatedAt,
//     }));

//     console.log(`Response prepared with ${responseData.length} records`);

//     res.status(200).json({
//       success: true,
//       statusCode: 200,
//       stats: stats,
//       data: responseData,
//     });
//   } catch (error) {
//     console.error("Error in getPeminjamanAllHandler:", {
//       error: error.message,
//       stack: error.stack,
//     });

//     res.status(500).json({
//       success: false,
//       statusCode: 500,
//       message: "Terjadi kesalahan saat mengambil data peminjaman",
//       error: error.message,
//     });
//   }
// };

// userController.js
const getPeminjamanAllHandler = async (req, res) => {
  try {
    // 1. Validasi user
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const userId = req.user.userId;

    // 2. Query untuk user spesifik
    const userFilter = { user: userId };

    // 3. Ambil data
    const [cncPeminjaman, laserPeminjaman, printingPeminjaman] =
      await Promise.all([
        Cnc.find(userFilter),
        Laser.find(userFilter),
        Printing.find(userFilter),
      ]);

    // 4. Gabungkan data
    let peminjamanForm = [
      ...cncPeminjaman,
      ...laserPeminjaman,
      ...printingPeminjaman,
    ];

    // 5. Cek ketersediaan data
    if (!peminjamanForm || peminjamanForm.length === 0) {
      return res.status(200).json({
        success: true,
        statusCode: 200,
        data: [],
      });
    }

    // 6. Sort berdasarkan status
    peminjamanForm.sort((a, b) => {
      if (
        a.status === "Menunggu" &&
        (b.status === "Disetujui" || b.status === "Ditolak")
      )
        return -1;
      if (
        (a.status === "Disetujui" || a.status === "Ditolak") &&
        b.status === "Menunggu"
      )
        return 1;
      return 0;
    });

    // 7. Format response data
    const responseData = peminjamanForm
      .filter((item) => item.user.toString() === userId.toString())
      .map((item) => ({
        id: item._id,
        nama_pemohon: item.nama_pemohon,
        nama_mesin: item.nama_mesin,
        alamat_esp: item.alamat_esp,
        tipe_pengguna: item.tipe_pengguna,
        nomor_identitas: item.nomor_identitas,
        asal_instansi: item.asal_instansi,
        tanggal_peminjaman: item.tanggal_peminjaman,
        awal_peminjaman: item.awal_peminjaman,
        akhir_peminjaman: item.akhir_peminjaman,
        status: item.status,
        waktu: item.waktu,
        isStarted: item.isStarted,
      }));

    // 8. Kirim response
    res.status(200).json({
      success: true,
      statusCode: 200,
      data: responseData,
    });
  } catch (error) {
    console.error("Error in getPeminjamanAllHandler:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch peminjaman data",
      error: error.message,
    });
  }
};

// const getPeminjamanAllHandler = async (req, res) => {
//   // const { userId } = req.username; // Asumsi userId diambil dari req.username
//   const userId = req.user.userId;
//   try {
//     // Periksa dan perbarui status sebelum mengambil data
//     // Ambil data dari ketiga model berdasarkan userId
//     const cncPeminjaman = await Cnc.find({ user: userId });
//     const laserPeminjaman = await Laser.find({ user: userId });
//     const printingPeminjaman = await Printing.find({ user: userId });

//     // Gabungkan semua data peminjaman dalam satu array
//     let peminjamanForm = [
//       ...cncPeminjaman,
//       ...laserPeminjaman,
//       ...printingPeminjaman,
//     ];

//     // Jika tidak ada data peminjaman ditemukan
//     if (!peminjamanForm || peminjamanForm.length === 0) {
//       return res.status(404).json({ message: "Data tidak ditemukan" });
//     }

//     // Urutkan data peminjaman berdasarkan status
//     peminjamanForm.sort((a, b) => {
//       if (
//         a.status === "Menunggu" &&
//         (b.status === "Disetujui" || b.status === "Ditolak")
//       )
//         return -1;
//       if (
//         (a.status === "Disetujui" || a.status === "Ditolak") &&
//         b.status === "Menunggu"
//       )
//         return 1;
//       return 0;
//     });

//     // Buat data respons
//     const responseData = peminjamanForm.map((item) => ({
//       id: item._id,
//       nama_pemohon: item.nama_pemohon,
//       nama_mesin: item.nama_mesin,
//       alamat_esp: item.alamat_esp,
//       tanggal_peminjaman: item.tanggal_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       awal_peminjaman: item.awal_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       akhir_peminjaman: item.akhir_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       status: item.status,
//       waktu: item.waktu,
//       isStarted: item.isStarted,
//     }));

//     // Kirim respons
//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: responseData,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// ----------------------------- metode 1 -------------------------------------- //
// const getPeminjamanByIdHandler = async (req, res) => {
//   const { peminjamanId } = req.params;
//   const { userId } = req.user.userId;

//   try {
//     // Cari data di ketiga model
//     let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId })
//       .populate("user", "username email")
//       .exec();
//     if (!peminjaman) {
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId })
//         .populate("user", "username email")
//         .exec();
//     }
//     if (!peminjaman) {
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId })
//         .populate("user", "username email")
//         .exec();
//     }

//     // Jika tidak ditemukan
//     if (!peminjaman) {
//       console.log('Peminjaman not found:', { peminjamanId, userId });
//       return res.status(404).json({
//         success: false,
//         message: "Data peminjaman tidak ditemukan"
//       });
//     }

//     // Buat data respons
//     const responseData = {
//       id: peminjaman._id,
//       nama_mesin: peminjaman.nama_mesin,
//       alamat_esp: peminjaman.alamat_esp,
//       email: peminjaman.user.email, // pastikan `user` telah dipopulasi
//       nama_pemohon: peminjaman.nama_pemohon,
//       tanggal_peminjaman: peminjaman.tanggal_peminjaman,
//       awal_peminjaman: peminjaman.awal_peminjaman,
//       akhir_peminjaman: peminjaman.akhir_peminjaman,
//       jumlah: peminjaman.jumlah,
//       jurusan: peminjaman.jurusan,
//       program_studi: peminjaman.program_studi,
//       kategori: peminjaman.kategori,
//       detail_keperluan: peminjaman.detail_keperluan,
//       desain_benda: peminjaman.desain_benda,
//       status: peminjaman.status,
//       waktu: peminjaman.waktu,
//       isStarted: peminjaman.isStarted,
//     };

//     console.log('Sending peminjaman data:', responseData);

//     return res.status(200).json({
//       success: true,
//       statusCode: 200,
//       data: responseData
//     });

//   } catch (err) {
//     console.error('Error in getPeminjamanById:', err);

//     if (err.name === "CastError") {
//       return res.status(404).json({
//         success: false,
//         message: "Data tidak ditemukan"
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan saat mengambil data",
//       error: err.message
//     });
//   }
// };

const getPeminjamanByIdHandler = async (req, res) => {
  try {
    const { peminjamanId } = req.params;

    // Log untuk debugging
    console.log("Request user:", req.user);
    console.log("Searching for peminjaman:", {
      peminjamanId,
      userId: req.user?.userId,
    });

    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    const userId = req.user.userId;

    // Cari peminjaman
    let peminjaman = await Cnc.findOne({
      _id: peminjamanId,
      user: userId,
    }).populate("user", "username email");

    if (!peminjaman) {
      peminjaman = await Laser.findOne({
        _id: peminjamanId,
        user: userId,
      }).populate("user", "username email");
    }

    if (!peminjaman) {
      peminjaman = await Printing.findOne({
        _id: peminjamanId,
        user: userId,
      }).populate("user", "username email");
    }

    if (!peminjaman) {
      console.log("Peminjaman not found:", { peminjamanId, userId });
      return res.status(404).json({
        success: false,
        message: "Data peminjaman tidak ditemukan",
      });
    }

    const responseData = {
      id: peminjaman._id,
      nama_mesin: peminjaman.nama_mesin,
      alamat_esp: peminjaman.alamat_esp,
      tipe_pengguna: peminjaman.tipe_pengguna,
      nomor_identitas: peminjaman.nomor_identitas,
      asal_instansi: peminjaman.asal_instansi,
      email: peminjaman.user?.email,
      nama_pemohon: peminjaman.nama_pemohon,
      tanggal_peminjaman: peminjaman.tanggal_peminjaman,
      awal_peminjaman: peminjaman.awal_peminjaman,
      akhir_peminjaman: peminjaman.akhir_peminjaman,
      jumlah: peminjaman.jumlah || 0,
      jurusan: peminjaman.jurusan || "",
      program_studi: peminjaman.program_studi || "",
      kategori: peminjaman.kategori || "",
      detail_keperluan: peminjaman.detail_keperluan || "",
      desain_benda: peminjaman.desain_benda || "",
      status: peminjaman.status,
      waktu: peminjaman.waktu,
      isStarted: peminjaman.isStarted || false,
    };

    console.log("Sending response:", responseData);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      data: responseData,
    });
  } catch (error) {
    console.error("Error in getPeminjamanById:", error);

    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,
        message: "Data peminjaman tidak ditemukan",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
      error: error.message,
    });
  }
};

const extendPeminjamanHandler = async (req, res) => {
  try {
    const { peminjamanId } = req.params;
    const { newEndTime, type } = req.body; // Pastikan parameter `type` diterima
    const userId = req.user.userId;

    console.log("Extend request received:", {
      peminjamanId,
      newEndTime,
      userId,
    });

    if (!type || !["cnc", "laser", "printing"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing machine type",
      });
    }

    const { Model } = getModelAndMesinName(type); // Tentukan model yang sesuai

    if (!newEndTime) {
      return res.status(400).json({
        success: false,
        message: "New end time is required",
      });
    }

    // Parse and validate the new end time
    const parsedEndTime = new Date(newEndTime);
    if (isNaN(parsedEndTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    // Find and update the peminjaman
    const peminjaman = await Model.findOneAndUpdate(
      {
        _id: peminjamanId,
        user: userId,
        status: "Disetujui",
        isStarted: true,
      },
      {
        $set: {
          akhir_peminjaman: parsedEndTime,
          updated_at: new Date(),
        },
        $inc: { extended_count: 1 },
      },
      { new: true }
    );

    if (!peminjaman) {
      return res.status(404).json({
        success: false,
        message: "Peminjaman not found or cannot be extended",
      });
    }

    res.status(200).json({
      success: true,
      message: "Peminjaman extended successfully",
      data: peminjaman,
    });
  } catch (error) {
    console.error("Error extending peminjaman:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// const extendPeminjamanHandler = async (req, res) => {
//   try {
//     const { peminjamanId } = req.params;
//     const { newEndTime } = req.body;
//     const userId = req.user.userId;

//     console.log("Extend request received:", {
//       peminjamanId,
//       newEndTime,
//       userId,
//     });

//     if (!newEndTime) {
//       return res.status(400).json({
//         success: false,
//         message: "New end time is required",
//       });
//     }

//     // Parse and validate the new end time
//     const parsedEndTime = new Date(newEndTime);
//     if (isNaN(parsedEndTime.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid date format",
//       });
//     }

//     // Find and update the peminjaman
//     const peminjaman = await Model.findOneAndUpdate(
//       {
//         _id: peminjamanId,
//         user: userId,
//         status: "Disetujui",
//         isStarted: true,
//       },
//       {
//         $set: {
//           akhir_peminjaman: parsedEndTime,
//           updated_at: new Date(),
//         },
//         $inc: { extended_count: 1 },
//       },
//       { new: true }
//     );

//     if (!peminjaman) {
//       return res.status(404).json({
//         success: false,
//         message: "Peminjaman not found or cannot be extended",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Peminjaman extended successfully",
//       data: peminjaman,
//     });
//   } catch (error) {
//     console.error("Error extending peminjaman:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

// const extendPeminjamanHandler = async (req, res) => {
//   const { peminjamanId } = req.params;
//   const { newEndTime } = req.body;
//   // const { userId } = req.username;
//   const { userId } = req.user.userId;

//   // Tambahkan logging untuk memastikan request yang diterima benar
//   logWithTimestamp(
//     `Menerima request perpanjangan peminjaman dengan ID: ${peminjamanId}`
//   );
//   logWithTimestamp(`Akhir peminjaman terbaru: ${newEndTime}`);

//   try {
//     let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });
//     if (!peminjaman) {
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//     }
//     if (!peminjaman) {
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       return res
//         .status(404)
//         .json({ message: "Data peminjaman tidak ditemukan" });
//     }

//     if (peminjaman.status !== "Disetujui" || !peminjaman.isStarted) {
//       return res
//         .status(400)
//         .json({ message: "Peminjaman belum disetujui atau belum dimulai." });
//     }

//     const now = new Date();
//     const currentEndTime = new Date(peminjaman.akhir_peminjaman);

//     // Check if the current time is past the end time
//     if (now > currentEndTime) {
//       return res.status(400).json({ message: "Peminjaman sudah berakhir" });
//     }

//     // Validate extension limits (e.g., max of 2 extensions)
//     if (peminjaman.extended_count >= 2) {
//       return res
//         .status(400)
//         .json({ message: "Batas perpanjangan sudah tercapai" });
//     }

//     // Ensure that newEndTime is a valid time in the future
//     if (new Date(newEndTime) <= now) {
//       return res
//         .status(400)
//         .json({ message: "Durasi perpanjangan tidak valid" });
//     }

//     // Update the new end time and increment the extension count
//     peminjaman.akhir_peminjaman = new Date(newEndTime);
//     peminjaman.extended_count += 1;
//     await peminjaman.save();

//     res.status(200).json({
//       success: true,
//       message: "Waktu peminjaman berhasil diperpanjang",
//       data: peminjaman,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan saat memperpanjang waktu peminjaman",
//     });
//   }
// };

// Update fungsi updateExpiredPeminjaman
const updateExpiredPeminjaman = async () => {
  let totalUpdated = 0;
  let hasSuccessfulUpdate = false;

  try {
    const now = new Date();
    const models = [Cnc, Laser, Printing];

    for (const Model of models) {
      try {
        const expiredPeminjaman = await Model.find({
          status: { $in: ["Menunggu", "Diproses"] },
          tanggal_peminjaman: { $lte: now },
          awal_peminjaman: { $lte: now },
        });

        for (const peminjaman of expiredPeminjaman) {
          try {
            peminjaman.status = "Ditolak";
            peminjaman.alasan =
              "Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.";
            await peminjaman.save();
            totalUpdated++;
            hasSuccessfulUpdate = true;
          } catch (saveError) {
            console.error("Error saving peminjaman:", saveError);
            // Continue with next peminjaman
            return false;
          }
        }
      } catch (modelError) {
        console.error(`Error processing ${Model.modelName}:`, modelError);
        // Continue with next model
      }
    }

    console.log(`${totalUpdated} peminjaman diperbarui karena kedaluwarsa.`);
    // logWithTimestamp(`Peminjaman diperbarui karena kedaluwarsa: ${totalUpdated}`);
    return hasSuccessfulUpdate;
  } catch (error) {
    console.error("Error in updateExpiredPeminjaman:", error);
    return false;
  }
};

// Update fungsi untuk format tanggal di getPeminjamanAllHandler
// const formatDate = (date) => {
//   if (!date) return null;
//   if (date instanceof Date) {
//     return date.toISOString().split("T")[0];
//   }
//   try {
//     const converted = new Date(date);
//     return converted.toISOString().split("T")[0];
//   } catch (error) {
//     return date;
//   }
// };

// Tambahkan fungsi untuk mengecek peminjaman secara manual
const checkPeminjamanStatus = async (req, res) => {
  const models = [Cnc, Laser, Printing];
  const now = new Date();
  const results = {};

  for (const Model of models) {
    try {
      // Fetch data with error handling
      let allPeminjaman;
      try {
        allPeminjaman = await Model.find({});
      } catch (error) {
        console.error(`Error processing ${Model.modelName}:`, error);
        continue; // Skip this model and continue with others
      }

      const expiredPeminjaman = allPeminjaman.filter((p) => {
        try {
          const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
          let awalPeminjaman;

          if (p.awal_peminjaman instanceof Date) {
            awalPeminjaman = p.awal_peminjaman;
          } else if (typeof p.awal_peminjaman === "string") {
            if (p.awal_peminjaman.includes("T")) {
              awalPeminjaman = new Date(p.awal_peminjaman);
            } else {
              const [hours, minutes] = p.awal_peminjaman.split(":");
              if (!hours || isNaN(hours) || isNaN(minutes)) {
                console.error(
                  `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
                  p.awal_peminjaman
                );
                return false;
              }
              awalPeminjaman = new Date(tanggalPeminjaman);
              awalPeminjaman.setHours(
                parseInt(hours, 10),
                parseInt(minutes, 10),
                0,
                0
              );
            }
          } else {
            console.error(
              `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
              p.awal_peminjaman
            );
            return false;
          }

          return awalPeminjaman < now && tanggalPeminjaman < now;
        } catch (error) {
          console.error(`Error processing peminjaman ${p._id}:`, error);
          return false;
        }
      });

      // Process model results
      results[Model.modelName] = {
        total: allPeminjaman.length,
        statusCounts: {
          Menunggu: allPeminjaman.filter((p) => p.status === "Menunggu").length,
          Disetujui: allPeminjaman.filter((p) => p.status === "Disetujui")
            .length,
          Ditolak: allPeminjaman.filter((p) => p.status === "Ditolak").length,
          Diproses: allPeminjaman.filter((p) => p.status === "Diproses").length,
          Other: allPeminjaman.filter(
            (p) =>
              !["Menunggu", "Disetujui", "Ditolak", "Diproses"].includes(
                p.status
              )
          ).length,
        },
        expired: expiredPeminjaman.length,
        needsUpdate: expiredPeminjaman.filter(
          (p) => p.status === "Menunggu" || p.status === "Diproses"
        ).length,
        details: allPeminjaman.map((p) => {
          try {
            const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
            let awalPeminjaman;

            if (p.awal_peminjaman instanceof Date) {
              awalPeminjaman = p.awal_peminjaman;
            } else if (typeof p.awal_peminjaman === "string") {
              if (p.awal_peminjaman.includes("T")) {
                awalPeminjaman = new Date(p.awal_peminjaman);
              } else {
                const [hours, minutes] = p.awal_peminjaman.split(":");
                awalPeminjaman = new Date(tanggalPeminjaman);
                awalPeminjaman.setHours(
                  parseInt(hours, 10),
                  parseInt(minutes, 10),
                  0,
                  0
                );
              }
            } else {
              console.error(
                `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
                p.awal_peminjaman
              );
              awalPeminjaman = null;
            }

            const isExpired =
              awalPeminjaman && tanggalPeminjaman < now && awalPeminjaman < now;
            return {
              id: p._id,
              status: p.status,
              tanggal_peminjaman: p.tanggal_peminjaman,
              awal_peminjaman: p.awal_peminjaman,
              isExpired: isExpired,
              needsUpdate:
                isExpired &&
                (p.status === "Menunggu" || p.status === "Diproses"),
            };
          } catch (error) {
            console.error(
              `Error processing detail for peminjaman ${p._id}:`,
              error
            );
            return {
              id: p._id,
              status: p.status,
              tanggal_peminjaman: p.tanggal_peminjaman,
              awal_peminjaman: p.awal_peminjaman,
              isExpired: false,
              needsUpdate: false,
            };
          }
        }),
      };
    } catch (error) {
      // Log error but continue processing other models
      console.error(`Error processing ${Model.modelName}:`, error);
      // Skip this model without adding to results
      continue;
    }
  }

  // Return whatever results we have
  return res.json(results);
};

// admin //

const adminPeminjamanHandler = async (req, res) => {
  try {
    const { type } = req.params;

    // Validasi role admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. Only admin can use this endpoint.",
      });
    }

    if (!["cnc", "laser", "printing"].includes(type)) {
      return res.status(400).json({ message: "Invalid machine name" });
    }

    // Handle file size limit error
    if (req.error && req.error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Ukuran file melebihi batas maksimum (2MB)",
      });
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(req.body.email)) {
      return res.status(400).json({
        success: false,
        message: "Format email tidak valid",
      });
    }

    // Validasi basic requirements
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File wajib diunggah",
      });
    }

    // Validasi tipe pengguna
    if (!req.body.tipe_pengguna) {
      return res.status(400).json({
        success: false,
        message: "Tipe pengguna wajib diisi",
      });
    }

    // Validasi nomor identitas berdasarkan tipe pengguna
    if (!req.body.nomor_identitas) {
      return res.status(400).json({
        success: false,
        message: "Nomor identitas wajib diisi",
      });
    }

    // Validasi format nomor identitas
    let isValidIdentitas = false;
    switch (req.body.tipe_pengguna) {
      case "Mahasiswa":
        isValidIdentitas = /^[0-9]{8,}$/.test(req.body.nomor_identitas);
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Format NIM tidak valid",
          });
        }
        break;
      case "Pekerja":
        isValidIdentitas = /^[0-9]{18,}$/.test(req.body.nomor_identitas);
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Format NIP tidak valid",
          });
        }
        break;
      case "PKL":
      case "Eksternal":
        if (!req.body.asal_instansi) {
          return res.status(400).json({
            success: false,
            message: "Asal instansi wajib diisi untuk pengguna external",
          });
        }
        isValidIdentitas = req.body.nomor_identitas.length >= 3;
        if (!isValidIdentitas) {
          return res.status(400).json({
            success: false,
            message: "Identitas harus memiliki minimal 3 karakter",
          });
        }
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Tipe pengguna tidak valid",
        });
    }

    const { Model, mesinName } = getModelAndMesinName(type);

    let {
      email,
      nama_pemohon,
      tanggal_peminjaman,
      awal_peminjaman,
      akhir_peminjaman,
      jumlah,
      jurusan,
      detail_keperluan,
      program_studi,
      kategori,
      desain_benda,
      tipe_pengguna,
      nomor_identitas,
      asal_instansi,
    } = req.body;
    // const { userId, userName } = req.username;
    const { userId, userName } = req.user;

    // Validasi jika diperlukan
    if (
      (kategori === "Praktek" || kategori === "Proyek Mata Kuliah") &&
      (!detail_keperluan || detail_keperluan.trim().length === 0)
    ) {
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Detail keperluan wajib diisi",
      });
    }

    // Konversi jumlah ke number
    jumlah = Number(jumlah);

    // Tambahkan validasi untuk memastikan jumlah adalah bilangan bulat
    if (!Number.isInteger(jumlah) || jumlah <= 0) {
      return res.status(400).json({
        success: false,
        statusCode: res.statusCode,
        message: "Jumlah harus berupa bilangan bulat positif",
      });
    }

    let convertedAwalPeminjaman;
    let convertedAkhirPeminjaman;

    try {
      // Convert awal_peminjaman
      if (!awal_peminjaman) {
        throw new Error("Waktu awal peminjaman harus diisi");
      }
      convertedAwalPeminjaman = convertTimeStringToDate(awal_peminjaman);

      // Convert akhir_peminjaman
      if (!akhir_peminjaman) {
        throw new Error("Waktu akhir peminjaman harus diisi");
      }
      convertedAkhirPeminjaman = convertTimeStringToDate(akhir_peminjaman);

      // Validasi logika waktu
      if (convertedAkhirPeminjaman <= convertedAwalPeminjaman) {
        throw new Error(
          "Waktu akhir peminjaman harus lebih besar dari waktu awal"
        );
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: error.message || "Format waktu tidak valid",
      });
    }

    // Tentukan alamat_esp berdasarkan nama_mesin
    let alamat_esp;
    switch (mesinName.toLowerCase()) {
      case "cnc milling":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/cnc/buttonPeminjaman";
        break;
      case "laser cutting":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/laser/buttonPeminjaman";
        break;
      case "3d printing":
        alamat_esp =
          "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/printing/buttonPeminjaman";
        break;
      default:
        return res.status(400).json({ message: "Invalid machine name" });
    }

    // TRY YANG PERTAMA
    // try {
    logWithTimestamp("Checking availability for the selected time slot...");

    const isAvailable = await checkAvailability(
      Model,
      tanggal_peminjaman,
      convertedAwalPeminjaman,
      convertedAkhirPeminjaman
    );

    if (!isAvailable) {
      logWithTimestamp("Selected time slot is not available.");
      return res.status(409).json({
        success: false,
        message: "Waktu yang dipilih tidak tersedia. Silakan pilih waktu lain.",
      });
    }

    logWithTimestamp(
      "Time slot is available, proceeding with saving peminjaman..."
    );

    const fileLink = await uploadFileToDrive(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    logWithTimestamp("File uploaded successfully, saving peminjaman...");

    // const fileLink = await uploadFileToDrive(req.file.buffer, req.file.originalname);
    const peminjamanEntry = await Model.create({
      nama_mesin: mesinName,
      alamat_esp, // Menyimpan alamat_esp yang telah ditentukan
      email,
      nama_pemohon,
      tipe_pengguna,
      nomor_identitas,
      asal_instansi: tipe_pengguna === "external" ? asal_instansi : undefined,
      tanggal_peminjaman,
      awal_peminjaman: convertedAwalPeminjaman,
      akhir_peminjaman: convertedAkhirPeminjaman,
      // tanggal_peminjaman,
      // awal_peminjaman,
      // akhir_peminjaman,
      jumlah,
      // jurusan: tipe_pengguna === 'mahasiswa' ? jurusan : undefined,
      // program_studi: tipe_pengguna === 'mahasiswa' ? program_studi : undefined,
      jurusan,
      detail_keperluan,
      program_studi,
      kategori,
      desain_benda: fileLink, // Simpan link file yang diunggah
      status: "Menunggu",
      user: userId,
      isStarted: false,
    });

    // Kirim notifikasi ke admin setelah peminjaman dibuat
    const notificationResult = await sendAdminNotification(
      peminjamanEntry,
      type
    );

    if (!notificationResult.success) {
      logWithTimestamp("Failed to send admin notifications");
    }

    res.status(201).json({
      success: true,
      statusCode: res.statusCode,
      message: "Uploaded!",
      data: {
        nama_mesin: peminjamanEntry.nama_mesin,
        alamat_esp, // Sertakan alamat_esp dalam respons jika diperlukan
        email,
        nama_pemohon,
        tipe_pengguna: peminjamanEntry.tipe_pengguna,
        nomor_identitas: peminjamanEntry.nomor_identitas,
        asal_instansi: peminjamanEntry.asal_instansi,
        tanggal_peminjaman: peminjamanEntry.tanggal_peminjaman,
        awal_peminjaman: peminjamanEntry.awal_peminjaman,
        akhir_peminjaman: peminjamanEntry.akhir_peminjaman,
        // tanggal_peminjaman,
        // awal_peminjaman,
        // akhir_peminjaman,

        jumlah,
        jurusan,
        detail_keperluan,
        program_studi,
        kategori,
        desain_benda: fileLink,
        status: peminjamanEntry.status,
        waktu: peminjamanEntry.waktu,
        user: userName,
        isStarted: peminjamanEntry.isStarted,
      },
    });
  } catch (err) {
    console.error(err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Ukuran file melebihi batas maksimum (2MB)",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error saat membuat peminjaman atau mengunggah file",
      error: err.message,
    });
  }
};

const getAdminPeminjamanAllHandler = async (req, res) => {
  try {
    // 1. Validasi admin
    if (!req.user?.userId || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. Only admin can access this endpoint",
      });
    }

    const adminId = req.user.userId;

    // 2. Query untuk admin spesifik
    const adminFilter = { user: adminId };

    // 3. Ambil data
    const [cncPeminjaman, laserPeminjaman, printingPeminjaman] =
      await Promise.all([
        Cnc.find(adminFilter),
        Laser.find(adminFilter),
        Printing.find(adminFilter),
      ]);

    // 4. Gabungkan data
    let peminjamanForm = [
      ...cncPeminjaman,
      ...laserPeminjaman,
      ...printingPeminjaman,
    ];

    // 5. Cek ketersediaan data
    if (!peminjamanForm || peminjamanForm.length === 0) {
      return res.status(200).json({
        success: true,
        statusCode: 200,
        data: [],
      });
    }

    // 6. Sort berdasarkan status
    peminjamanForm.sort((a, b) => {
      if (
        a.status === "Menunggu" &&
        (b.status === "Disetujui" || b.status === "Ditolak")
      )
        return -1;
      if (
        (a.status === "Disetujui" || a.status === "Ditolak") &&
        b.status === "Menunggu"
      )
        return 1;
      return 0;
    });

    // 7. Format response data
    const responseData = peminjamanForm
      .filter((item) => item.user.toString() === adminId.toString())
      .map((item) => ({
        id: item._id,
        nama_pemohon: item.nama_pemohon,
        nama_mesin: item.nama_mesin,
        alamat_esp: item.alamat_esp,
        tipe_pengguna: item.tipe_pengguna,
        nomor_identitas: item.nomor_identitas,
        asal_instansi: item.asal_instansi,
        email: item.email,
        tanggal_peminjaman: item.tanggal_peminjaman,
        awal_peminjaman: item.awal_peminjaman,
        akhir_peminjaman: item.akhir_peminjaman,
        jumlah: item.jumlah,
        jurusan: item.jurusan,
        program_studi: item.program_studi,
        kategori: item.kategori,
        detail_keperluan: item.detail_keperluan,
        desain_benda: item.desain_benda,
        status: item.status,
        alasan: item.alasan,
        waktu: item.waktu,
        isStarted: item.isStarted,
      }));

    // 8. Tambahkan statistik untuk admin
    const stats = {
      total: responseData.length,
      statusCount: {
        Menunggu: responseData.filter((item) => item.status === "Menunggu")
          .length,
        Disetujui: responseData.filter((item) => item.status === "Disetujui")
          .length,
        Ditolak: responseData.filter((item) => item.status === "Ditolak")
          .length,
      },
    };

    // 9. Kirim response
    res.status(200).json({
      success: true,
      statusCode: 200,
      stats,
      data: responseData,
    });
  } catch (error) {
    console.error("Error in getAdminPeminjamanHandler:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin peminjaman data",
      error: error.message,
    });
  }
};

const getPeminjamanAdminById = async (req, res) => {
  try {
    const { peminjamanId } = req.params;

    // Log untuk debugging
    console.log("Request admin:", req.user);
    console.log("Searching for peminjaman:", {
      peminjamanId,
      adminId: req.user?.userId,
    });

    // Validasi admin
    if (!req.user || !req.user.userId || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. Only admin can access this endpoint",
      });
    }

    const adminId = req.user.userId;

    // Cari peminjaman
    let peminjaman = await Cnc.findOne({
      _id: peminjamanId,
      user: adminId,
    }).populate("user", "username email");

    if (!peminjaman) {
      peminjaman = await Laser.findOne({
        _id: peminjamanId,
        user: adminId,
      }).populate("user", "username email");
    }

    if (!peminjaman) {
      peminjaman = await Printing.findOne({
        _id: peminjamanId,
        user: adminId,
      }).populate("user", "username email");
    }

    if (!peminjaman) {
      console.log("Peminjaman not found:", { peminjamanId, adminId });
      return res.status(404).json({
        success: false,
        message: "Data peminjaman tidak ditemukan",
      });
    }

    const responseData = {
      id: peminjaman._id,
      nama_mesin: peminjaman.nama_mesin,
      alamat_esp: peminjaman.alamat_esp,
      tipe_pengguna: peminjaman.tipe_pengguna,
      nomor_identitas: peminjaman.nomor_identitas,
      asal_instansi: peminjaman.asal_instansi,
      email: peminjaman.user?.email,
      nama_pemohon: peminjaman.nama_pemohon,
      tanggal_peminjaman: peminjaman.tanggal_peminjaman,
      awal_peminjaman: peminjaman.awal_peminjaman,
      akhir_peminjaman: peminjaman.akhir_peminjaman,
      jumlah: peminjaman.jumlah || 0,
      jurusan: peminjaman.jurusan || "",
      program_studi: peminjaman.program_studi || "",
      kategori: peminjaman.kategori || "",
      detail_keperluan: peminjaman.detail_keperluan || "",
      desain_benda: peminjaman.desain_benda || "",
      status: peminjaman.status,
      alasan: peminjaman.alasan || "",
      waktu: peminjaman.waktu,
      isStarted: peminjaman.isStarted || false,
      admin: {
        id: peminjaman.user?._id,
        username: peminjaman.user?.username,
        email: peminjaman.user?.email,
      },
    };

    console.log("Sending response:", responseData);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      data: responseData,
    });
  } catch (error) {
    console.error("Error in getPeminjamanAdminById:", error);

    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,
        message: "Data peminjaman tidak ditemukan",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
      error: error.message,
    });
  }
};
// Jalankan fungsi ini secara berkala, misalnya setiap 5 menit
const updateInterval = 3 * 60 * 1000; // 5 menit dalam milidetik
setInterval(updateExpiredPeminjaman, updateInterval);

module.exports = {
  upload,
  peminjamanHandler,
  getPeminjamanAllHandler,
  getPeminjamanByIdHandler,
  extendPeminjamanHandler,
  updateExpiredPeminjaman,
  checkPeminjamanStatus,
  adminPeminjamanHandler,
  getAdminPeminjamanAllHandler,
  getPeminjamanAdminById,
};

// ----------------------------------------------------------------------------------------------------------------- //

// userController.js

// const { checkAvailability } = require("../middleware/checkAvailability");
// const axios = require("axios"); // Untuk mengirim request ke ESP32
// const { google } = require("googleapis");
// const { Readable } = require("stream");
// const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
// const SCOPE = ["https://www.googleapis.com/auth/drive"];

// const multer = require("multer");

// // const storage = multer.memoryStorage();
// // const upload = multer({ storage });

// // const oauth2Client = new google.auth.JWT(
// //     process.env.client_email,
// //     null,
// //     process.env.private_key.replace(/\\n/g, '\n'),
// //     SCOPE
// // );

// // Set up Google Drive API
// const oauth2Client = new google.auth.JWT(
//   process.env.GOOGLE_CLIENT_EMAIL || "",
//   null,
//   process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
//   ["https://www.googleapis.com/auth/drive.file"]
// );

// const drive = google.drive({ version: "v3", auth: oauth2Client });

// // Multer configuration
// const storage = multer.memoryStorage();
// const upload = multer({
//   storage: storage,
//   limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB limit
//   fileFilter: (req, file, cb) => {
//     // Allowed MIME types
//     const allowedMimeTypes = [
//       "image/jpeg",
//       "image/png",
//       "image/jpg",
//       "application/pdf",
//       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//     ];

//     // Check MIME type and extension
//     const fileExtension = file.originalname.split(".").pop().toLowerCase();
//     if (
//       allowedMimeTypes.includes(file.mimetype) ||
//       ["pdf", "docx", "jpg", "jpeg", "png"].includes(fileExtension)
//     ) {
//       cb(null, true);
//     } else {
//       cb(
//         new Error("Invalid file type. Only images, PDFs, and DOCX are allowed.")
//       );
//     }
//   },
// });

// function bufferToStream(buffer) {
//   const stream = new Readable();
//   stream.push(buffer);
//   stream.push(null);
//   return stream;
// }

// const uploadFileToDrive = async (fileBuffer, fileName, mimeType) => {
//   try {
//     const fileStream = bufferToStream(fileBuffer);

//     const response = await drive.files.create({
//       requestBody: {
//         name: fileName,
//         mimeType: mimeType,
//         parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
//       },
//       media: {
//         mimeType: mimeType,
//         body: fileStream,
//       },
//     });

//     await drive.permissions.create({
//       fileId: response.data.id,
//       requestBody: {
//         role: "reader",
//         type: "anyone",
//       },
//     });

//     const file = await drive.files.get({
//       fileId: response.data.id,
//       fields: "webViewLink",
//     });

//     return file.data.webViewLink;
//   } catch (error) {
//     console.error("Error uploading file to Google Drive:", error);
//     throw error;
//   }
// };

// function logWithTimestamp(message, data = null) {
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
//   if (data) {
//     console.log(`[${formattedTime}] : ${message}`, data);
//   } else {
//     console.log(`[${formattedTime}] : ${message}`);
//   }
// }

// const getModelAndMesinName = (type) => {
//   switch (type) {
//     case "cnc":
//       return { Model: Cnc, mesinName: "Cnc Milling" };
//     case "laser":
//       return { Model: Laser, mesinName: "Laser Cutting" };
//     case "printing":
//       return { Model: Printing, mesinName: "3D Printing" };
//     default:
//       throw new Error("Invalid type parameter");
//   }
// };

// const peminjamanHandler = async (req, res) => {
//   try {
//     const { type } = req.params;

//     if (!["cnc", "laser", "printing"].includes(type)) {
//       return res.status(400).json({ message: "Invalid machine name" });
//     }

//     // Handle file size limit error
//     if (req.error && req.error.code === "LIMIT_FILE_SIZE") {
//       return res.status(400).json({
//         success: false,
//         message: "Ukuran file melebihi batas maksimum (2MB)",
//       });
//     }

//     // Validasi format email
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//     if (!emailRegex.test(req.body.email)) {
//       return res.status(400).json({
//         success: false,
//         message: "Format email tidak valid",
//       });
//     }

//     // Validasi basic requirements
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "File wajib diunggah",
//       });
//     }

//     const { Model, mesinName } = getModelAndMesinName(type);

//     let {
//       email,
//       nama_pemohon,
//       tanggal_peminjaman,
//       awal_peminjaman,
//       akhir_peminjaman,
//       jumlah,
//       jurusan,
//       detail_keperluan,
//       program_studi,
//       kategori,
//       desain_benda,
//     } = req.body;
//     const { userId, userName } = req.username;

//     // Validasi jika diperlukan
//     if (
//       (kategori === "Praktek" || kategori === "Proyek Mata Kuliah") &&
//       (!detail_keperluan || detail_keperluan.trim().length === 0)
//     ) {
//       return res.status(400).json({
//         success: false,
//         statusCode: res.statusCode,
//         message: "Detail keperluan wajib diisi",
//       });
//     }

//     // Konversi jumlah ke number
//     jumlah = Number(jumlah);

//     // Tambahkan validasi untuk memastikan jumlah adalah bilangan bulat
//     if (!Number.isInteger(jumlah) || jumlah <= 0) {
//       return res.status(400).json({
//         success: false,
//         statusCode: res.statusCode,
//         message: "Jumlah harus berupa bilangan bulat positif",
//       });
//     }

//     // let convertedAwalPeminjaman;
//     // let convertedAkhirPeminjaman;

//     // // Convert awal_peminjaman and akhir_peminjaman to Date objects
//     // if (awal_peminjaman) {
//     //     convertedAwalPeminjaman = convertTimeStringToDate(awal_peminjaman);
//     // }
//     // if (akhir_peminjaman) {
//     //     convertedAkhirPeminjaman = convertTimeStringToDate(akhir_peminjaman);
//     // }

//     let convertedAwalPeminjaman;
//     let convertedAkhirPeminjaman;

//     try {
//       // Convert awal_peminjaman
//       if (!awal_peminjaman) {
//         throw new Error("Waktu awal peminjaman harus diisi");
//       }
//       convertedAwalPeminjaman = convertTimeStringToDate(awal_peminjaman);

//       // Convert akhir_peminjaman
//       if (!akhir_peminjaman) {
//         throw new Error("Waktu akhir peminjaman harus diisi");
//       }
//       convertedAkhirPeminjaman = convertTimeStringToDate(akhir_peminjaman);

//       // Validasi logika waktu
//       if (convertedAkhirPeminjaman <= convertedAwalPeminjaman) {
//         throw new Error(
//           "Waktu akhir peminjaman harus lebih besar dari waktu awal"
//         );
//       }
//     } catch (error) {
//       return res.status(400).json({
//         success: false,
//         statusCode: 400,
//         message: error.message || "Format waktu tidak valid",
//       });
//     }

//     // Tentukan alamat_esp berdasarkan nama_mesin
//     let alamat_esp;
//     // switch (mesinName.toLowerCase()) {
//     //     case 'cnc milling':
//     //         alamat_esp = "https://kh8ppwzx-3000.asse.devtunnels.ms/sensor/cnc/buttonPeminjaman";
//     //         break;
//     //     case 'laser cutting':
//     //         alamat_esp = "https://kh8ppwzx-3000.asse.devtunnels.ms/sensor/laser/buttonPeminjaman";
//     //         break;
//     //     case '3d printing':
//     //         alamat_esp = "https://kh8ppwzx-3000.asse.devtunnels.ms/sensor/printing/buttonPeminjaman";
//     //         break;
//     //     default:
//     //         return res.status(400).json({ message: 'Invalid machine name' });
//     // }
//     switch (mesinName.toLowerCase()) {
//       case "cnc milling":
//         alamat_esp =
//           "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/cnc/buttonPeminjaman";
//         break;
//       case "laser cutting":
//         alamat_esp =
//           "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/laser/buttonPeminjaman";
//         break;
//       case "3d printing":
//         alamat_esp =
//           "https://kh8ppwzx-5000.asse.devtunnels.ms/sensor/printing/buttonPeminjaman";
//         break;
//       default:
//         return res.status(400).json({ message: "Invalid machine name" });
//     }

//     // if (!email || !nama_pemohon || !tanggal_peminjaman || !awal_peminjaman || !akhir_peminjaman || !jumlah || !program_studi || !kategori || !req.file) {
//     //     return res.status(400).json({
//     //         success: false,
//     //         statusCode: res.statusCode,
//     //         message: "Please complete input data"
//     //     });
//     // }

//     // TRY YANG PERTAMA
//     // try {
//     logWithTimestamp("Checking availability for the selected time slot...");

//     const isAvailable = await checkAvailability(
//       Model,
//       tanggal_peminjaman,
//       convertedAwalPeminjaman,
//       convertedAkhirPeminjaman
//     );

//     if (!isAvailable) {
//       logWithTimestamp("Selected time slot is not available.");
//       return res.status(409).json({
//         success: false,
//         message: "Waktu yang dipilih tidak tersedia. Silakan pilih waktu lain.",
//       });
//     }

//     logWithTimestamp(
//       "Time slot is available, proceeding with saving peminjaman..."
//     );

//     const fileLink = await uploadFileToDrive(
//       req.file.buffer,
//       req.file.originalname,
//       req.file.mimetype
//     );

//     logWithTimestamp("File uploaded successfully, saving peminjaman...");

//     // const fileLink = await uploadFileToDrive(req.file.buffer, req.file.originalname);
//     const peminjamanEntry = await Model.create({
//       nama_mesin: mesinName,
//       alamat_esp, // Menyimpan alamat_esp yang telah ditentukan
//       email,
//       nama_pemohon,
//       tanggal_peminjaman,
//       awal_peminjaman: convertedAwalPeminjaman,
//       akhir_peminjaman: convertedAkhirPeminjaman,
//       // tanggal_peminjaman,
//       // awal_peminjaman,
//       // akhir_peminjaman,
//       jumlah,
//       jurusan,
//       detail_keperluan,
//       program_studi,
//       kategori,
//       desain_benda: fileLink, // Simpan link file yang diunggah
//       status: "Menunggu",
//       user: userId,
//       isStarted: false,
//     });

//     res.status(201).json({
//       success: true,
//       statusCode: res.statusCode,
//       message: "Uploaded!",
//       data: {
//         nama_mesin: peminjamanEntry.nama_mesin,
//         alamat_esp, // Sertakan alamat_esp dalam respons jika diperlukan
//         email,
//         nama_pemohon,
//         tanggal_peminjaman: peminjamanEntry.tanggal_peminjaman,
//         awal_peminjaman: peminjamanEntry.awal_peminjaman,
//         akhir_peminjaman: peminjamanEntry.akhir_peminjaman,
//         // tanggal_peminjaman,
//         // awal_peminjaman,
//         // akhir_peminjaman,
//         jumlah,
//         jurusan,
//         detail_keperluan,
//         program_studi,
//         kategori,
//         desain_benda: fileLink,
//         status: peminjamanEntry.status,
//         waktu: peminjamanEntry.waktu,
//         user: userName,
//         isStarted: peminjamanEntry.isStarted,
//       },
//     });
//   } catch (err) {
//     console.error(err);
//     if (err.code === "LIMIT_FILE_SIZE") {
//       return res.status(400).json({
//         success: false,
//         message: "Ukuran file melebihi batas maksimum (2MB)",
//       });
//     }
//     res.status(500).json({
//       success: false,
//       message: "Error saat membuat peminjaman atau mengunggah file",
//       error: err.message,
//     });
//   }
// };

// // Helper function to convert time string to a Date object
// function convertTimeStringToDate(timeString) {
//   if (!timeString) return null;

//   try {
//     // Handle ISO string format
//     if (timeString.includes("T")) {
//       return new Date(timeString);
//     }

//     // Handle 12-hour format (10:00 AM/PM)
//     const [time, modifier] = timeString.split(" ");
//     let [hours, minutes] = time.split(":");

//     hours = parseInt(hours, 10);
//     minutes = parseInt(minutes, 10);

//     if (isNaN(hours) || isNaN(minutes)) {
//       throw new Error("Invalid time format");
//     }

//     if (modifier === "PM" && hours < 12) {
//       hours += 12;
//     }
//     if (modifier === "AM" && hours === 12) {
//       hours = 0;
//     }

//     const date = new Date();
//     date.setHours(hours, minutes, 0, 0);
//     return date;
//   } catch (error) {
//     throw new Error("Invalid time format");
//   }

//   // const [time, modifier] = timeString.split(' ');
//   // let [hours, minutes] = time.split(':');
//   // if (modifier === 'PM' && hours !== '12') {
//   //     hours = parseInt(hours, 10) + 12;
//   // }
//   // if (modifier === 'AM' && hours === '12') {
//   //     hours = '00';
//   // }
//   // const date = new Date();
//   // date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
//   // return date;
// }

// const getPeminjamanAllHandler = async (req, res) => {
//   const { userId } = req.username; // Asumsi userId diambil dari req.username
//   try {
//     // Periksa dan perbarui status sebelum mengambil data
//     // Ambil data dari ketiga model berdasarkan userId
//     const cncPeminjaman = await Cnc.find({ user: userId });
//     const laserPeminjaman = await Laser.find({ user: userId });
//     const printingPeminjaman = await Printing.find({ user: userId });

//     // Gabungkan semua data peminjaman dalam satu array
//     let peminjamanForm = [
//       ...cncPeminjaman,
//       ...laserPeminjaman,
//       ...printingPeminjaman,
//     ];

//     // Jika tidak ada data peminjaman ditemukan
//     if (!peminjamanForm || peminjamanForm.length === 0) {
//       return res.status(404).json({ message: "Data tidak ditemukan" });
//     }

//     // Urutkan data peminjaman berdasarkan status
//     peminjamanForm.sort((a, b) => {
//       if (
//         a.status === "Menunggu" &&
//         (b.status === "Disetujui" || b.status === "Ditolak")
//       )
//         return -1;
//       if (
//         (a.status === "Disetujui" || a.status === "Ditolak") &&
//         b.status === "Menunggu"
//       )
//         return 1;
//       return 0;
//     });

//     // Buat data respons
//     const responseData = peminjamanForm.map((item) => ({
//       id: item._id,
//       nama_pemohon: item.nama_pemohon,
//       nama_mesin: item.nama_mesin,
//       alamat_esp: item.alamat_esp,
//       tanggal_peminjaman: item.tanggal_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       awal_peminjaman: item.awal_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       akhir_peminjaman: item.akhir_peminjaman, // Pastikan dikirim sebagai ISO 8601
//       status: item.status,
//       waktu: item.waktu,
//       isStarted: item.isStarted,
//     }));

//     // Kirim respons
//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: responseData,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// const getPeminjamanByIdHandler = async (req, res) => {
//   const { peminjamanId } = req.params;
//   const { userId } = req.username;
//   try {
//     // Cari data di ketiga model
//     let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId })
//       .populate("user", "username email")
//       .exec();
//     if (!peminjaman) {
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId })
//         .populate("user", "username email")
//         .exec();
//     }
//     if (!peminjaman) {
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId })
//         .populate("user", "username email")
//         .exec();
//     }

//     // Jika tidak ditemukan
//     if (!peminjaman) {
//       return res.status(404).json({ message: "Data tidak ditemukan" });
//     }

//     // Buat data respons
//     const responseData = {
//       id: peminjaman._id,
//       nama_mesin: peminjaman.nama_mesin,
//       alamat_esp: peminjaman.alamat_esp,
//       email: peminjaman.user.email, // pastikan `user` telah dipopulasi
//       nama_pemohon: peminjaman.nama_pemohon,
//       tanggal_peminjaman: peminjaman.tanggal_peminjaman,
//       awal_peminjaman: peminjaman.awal_peminjaman,
//       akhir_peminjaman: peminjaman.akhir_peminjaman,
//       jumlah: peminjaman.jumlah,
//       jurusan: peminjaman.jurusan,
//       program_studi: peminjaman.program_studi,
//       kategori: peminjaman.kategori,
//       detail_keperluan: peminjaman.detail_keperluan,
//       desain_benda: peminjaman.desain_benda,
//       status: peminjaman.status,
//       waktu: peminjaman.waktu,
//       isStarted: peminjaman.isStarted,
//     };

//     // Kirim respons
//     res.status(200).json({
//       success: true,
//       statusCode: res.statusCode,
//       data: responseData,
//     });
//   } catch (err) {
//     if (err.name === "CastError") {
//       return res.status(404).json({ message: "Data tidak ditemukan" });
//     }
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

// const extendPeminjamanHandler = async (req, res) => {
//   const { peminjamanId } = req.params;
//   const { newEndTime } = req.body;
//   const { userId } = req.username;

//   // Tambahkan logging untuk memastikan request yang diterima benar
//   logWithTimestamp(
//     `Menerima request perpanjangan peminjaman dengan ID: ${peminjamanId}`
//   );
//   logWithTimestamp(`Akhir peminjaman terbaru: ${newEndTime}`);

//   try {
//     let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });
//     if (!peminjaman) {
//       peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//     }
//     if (!peminjaman) {
//       peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//     }

//     if (!peminjaman) {
//       return res
//         .status(404)
//         .json({ message: "Data peminjaman tidak ditemukan" });
//     }

//     if (peminjaman.status !== "Disetujui" || !peminjaman.isStarted) {
//       return res
//         .status(400)
//         .json({ message: "Peminjaman belum disetujui atau belum dimulai." });
//     }

//     const now = new Date();
//     const currentEndTime = new Date(peminjaman.akhir_peminjaman);

//     // Check if the current time is past the end time
//     if (now > currentEndTime) {
//       return res.status(400).json({ message: "Peminjaman sudah berakhir" });
//     }

//     // Validate extension limits (e.g., max of 2 extensions)
//     if (peminjaman.extended_count >= 2) {
//       return res
//         .status(400)
//         .json({ message: "Batas perpanjangan sudah tercapai" });
//     }

//     // Ensure that newEndTime is a valid time in the future
//     if (new Date(newEndTime) <= now) {
//       return res
//         .status(400)
//         .json({ message: "Durasi perpanjangan tidak valid" });
//     }

//     // Update the new end time and increment the extension count
//     peminjaman.akhir_peminjaman = new Date(newEndTime);
//     peminjaman.extended_count += 1;
//     await peminjaman.save();

//     res.status(200).json({
//       success: true,
//       message: "Waktu peminjaman berhasil diperpanjang",
//       data: peminjaman,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({
//       success: false,
//       message: "Terjadi kesalahan saat memperpanjang waktu peminjaman",
//     });
//   }
// };

// // Fungsi untuk memeriksa dan memperbarui status peminjaman
// // const updateExpiredPeminjaman = async () => {
// //     try {
// //         const models = [Cnc, Laser, Printing];
// //         const now = new Date();
// //         let totalUpdated = 0;

// //         for (const Model of models) {
// //             const expiredPeminjaman = await Model.find({
// //                 status: { $in: ['Menunggu', 'Diproses'] },
// //                 tanggal_peminjaman: { $lte: now },
// //                 awal_peminjaman: { $lte: now }
// //             });

// //             for (const peminjaman of expiredPeminjaman) {
// //                 peminjaman.status = 'Ditolak';
// //                 peminjaman.alasan = 'Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.';
// //                 await peminjaman.save();
// //                 totalUpdated++;
// //             }
// //         }

// //         console.log(`${totalUpdated} peminjaman diperbarui karena kedaluwarsa.`);
// //         return totalUpdated > 0; // Return true if any peminjaman was updated
// //     } catch (error) {
// //         console.error('Error dalam updateExpiredPeminjaman:', error);
// //         return false;
// //     }
// // };

// // Update fungsi updateExpiredPeminjaman
// const updateExpiredPeminjaman = async () => {
//   let totalUpdated = 0;
//   let hasSuccessfulUpdate = false;

//   try {
//     const now = new Date();
//     const models = [Cnc, Laser, Printing];

//     for (const Model of models) {
//       try {
//         const expiredPeminjaman = await Model.find({
//           status: { $in: ["Menunggu", "Diproses"] },
//           tanggal_peminjaman: { $lte: now },
//           awal_peminjaman: { $lte: now },
//         });

//         for (const peminjaman of expiredPeminjaman) {
//           try {
//             peminjaman.status = "Ditolak";
//             peminjaman.alasan =
//               "Peminjaman otomatis ditolak karena melebihi batas awal peminjaman.";
//             await peminjaman.save();
//             totalUpdated++;
//             hasSuccessfulUpdate = true;
//           } catch (saveError) {
//             console.error("Error saving peminjaman:", saveError);
//             // Continue with next peminjaman
//           }
//         }
//       } catch (modelError) {
//         console.error(`Error processing ${Model.modelName}:`, modelError);
//         // Continue with next model
//       }
//     }

//     console.log(`${totalUpdated} peminjaman diperbarui karena kedaluwarsa.`);
//     // logWithTimestamp(`Peminjaman diperbarui karena kedaluwarsa: ${totalUpdated}`);
//     return hasSuccessfulUpdate;
//   } catch (error) {
//     console.error("Error in updateExpiredPeminjaman:", error);
//     return false;
//   }
// };

// // Update fungsi untuk format tanggal di getPeminjamanAllHandler
// const formatDate = (date) => {
//   if (!date) return null;
//   if (date instanceof Date) {
//     return date.toISOString().split("T")[0];
//   }
//   try {
//     const converted = new Date(date);
//     return converted.toISOString().split("T")[0];
//   } catch (error) {
//     return date;
//   }
// };

// // Tambahkan fungsi untuk mengecek peminjaman secara manual
// const checkPeminjamanStatus = async (req, res) => {
//   const models = [Cnc, Laser, Printing];
//   const now = new Date();
//   const results = {};

//   for (const Model of models) {
//     try {
//       // Fetch data with error handling
//       let allPeminjaman;
//       try {
//         allPeminjaman = await Model.find({});
//       } catch (error) {
//         console.error(`Error processing ${Model.modelName}:`, error);
//         continue; // Skip this model and continue with others
//       }

//       const expiredPeminjaman = allPeminjaman.filter((p) => {
//         try {
//           const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
//           let awalPeminjaman;

//           if (p.awal_peminjaman instanceof Date) {
//             awalPeminjaman = p.awal_peminjaman;
//           } else if (typeof p.awal_peminjaman === "string") {
//             if (p.awal_peminjaman.includes("T")) {
//               awalPeminjaman = new Date(p.awal_peminjaman);
//             } else {
//               const [hours, minutes] = p.awal_peminjaman.split(":");
//               if (!hours || isNaN(hours) || isNaN(minutes)) {
//                 console.error(
//                   `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
//                   p.awal_peminjaman
//                 );
//                 return false;
//               }
//               awalPeminjaman = new Date(tanggalPeminjaman);
//               awalPeminjaman.setHours(
//                 parseInt(hours, 10),
//                 parseInt(minutes, 10),
//                 0,
//                 0
//               );
//             }
//           } else {
//             console.error(
//               `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
//               p.awal_peminjaman
//             );
//             return false;
//           }

//           return awalPeminjaman < now && tanggalPeminjaman < now;
//         } catch (error) {
//           console.error(`Error processing peminjaman ${p._id}:`, error);
//           return false;
//         }
//       });

//       // Process model results
//       results[Model.modelName] = {
//         total: allPeminjaman.length,
//         statusCounts: {
//           Menunggu: allPeminjaman.filter((p) => p.status === "Menunggu").length,
//           Disetujui: allPeminjaman.filter((p) => p.status === "Disetujui")
//             .length,
//           Ditolak: allPeminjaman.filter((p) => p.status === "Ditolak").length,
//           Diproses: allPeminjaman.filter((p) => p.status === "Diproses").length,
//           Other: allPeminjaman.filter(
//             (p) =>
//               !["Menunggu", "Disetujui", "Ditolak", "Diproses"].includes(
//                 p.status
//               )
//           ).length,
//         },
//         expired: expiredPeminjaman.length,
//         needsUpdate: expiredPeminjaman.filter(
//           (p) => p.status === "Menunggu" || p.status === "Diproses"
//         ).length,
//         details: allPeminjaman.map((p) => {
//           try {
//             const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
//             let awalPeminjaman;

//             if (p.awal_peminjaman instanceof Date) {
//               awalPeminjaman = p.awal_peminjaman;
//             } else if (typeof p.awal_peminjaman === "string") {
//               if (p.awal_peminjaman.includes("T")) {
//                 awalPeminjaman = new Date(p.awal_peminjaman);
//               } else {
//                 const [hours, minutes] = p.awal_peminjaman.split(":");
//                 awalPeminjaman = new Date(tanggalPeminjaman);
//                 awalPeminjaman.setHours(
//                   parseInt(hours, 10),
//                   parseInt(minutes, 10),
//                   0,
//                   0
//                 );
//               }
//             } else {
//               console.error(
//                 `Invalid awal_peminjaman format for peminjaman ${p._id}:`,
//                 p.awal_peminjaman
//               );
//               awalPeminjaman = null;
//             }

//             const isExpired =
//               awalPeminjaman && tanggalPeminjaman < now && awalPeminjaman < now;
//             return {
//               id: p._id,
//               status: p.status,
//               tanggal_peminjaman: p.tanggal_peminjaman,
//               awal_peminjaman: p.awal_peminjaman,
//               isExpired: isExpired,
//               needsUpdate:
//                 isExpired &&
//                 (p.status === "Menunggu" || p.status === "Diproses"),
//             };
//           } catch (error) {
//             console.error(
//               `Error processing detail for peminjaman ${p._id}:`,
//               error
//             );
//             return {
//               id: p._id,
//               status: p.status,
//               tanggal_peminjaman: p.tanggal_peminjaman,
//               awal_peminjaman: p.awal_peminjaman,
//               isExpired: false,
//               needsUpdate: false,
//             };
//           }
//         }),
//       };
//     } catch (error) {
//       // Log error but continue processing other models
//       console.error(`Error processing ${Model.modelName}:`, error);
//       // Skip this model without adding to results
//       continue;
//     }
//   }

//   // Return whatever results we have
//   return res.json(results);
// };
// // const checkPeminjamanStatus = async (req, res) => {
// //     const models = [Cnc, Laser, Printing];
// //     const now = new Date();
// //     const results = {};

// //     for (const Model of models) {
// //         const allPeminjaman = await Model.find({});
// //         const expiredPeminjaman = allPeminjaman.filter(p => {
// //             const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
// //             let awalPeminjaman;
// //             if (p.awal_peminjaman instanceof Date) {
// //                 awalPeminjaman = p.awal_peminjaman;
// //             } else if (typeof p.awal_peminjaman === 'string') {
// //                 if (p.awal_peminjaman.includes('T')) {
// //                     awalPeminjaman = new Date(p.awal_peminjaman);
// //                 } else {
// //                     const [hours, minutes] = p.awal_peminjaman.split(':');
// //                     awalPeminjaman = new Date(tanggalPeminjaman);
// //                     if (!hours || isNaN(hours) || isNaN(minutes)) {
// //                         console.error(`Invalid awal_peminjaman format for peminjaman ${p._id}:`, p.awal_peminjaman);
// //                         return false;
// //                     }
// //                     awalPeminjaman.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
// //                 }
// //             } else {
// //                 console.error(`Invalid awal_peminjaman format for peminjaman ${p._id}:`, p.awal_peminjaman);
// //                 return false;
// //             }
// //             return awalPeminjaman < now && tanggalPeminjaman < now;
// //         });

// //         results[Model.modelName] = {
// //             total: allPeminjaman.length,
// //             statusCounts: {
// //                 Menunggu: allPeminjaman.filter(p => p.status === 'Menunggu').length,
// //                 Disetujui: allPeminjaman.filter(p => p.status === 'Disetujui').length,
// //                 Ditolak: allPeminjaman.filter(p => p.status === 'Ditolak').length,
// //                 Diproses: allPeminjaman.filter(p => p.status === 'Diproses').length,
// //                 Other: allPeminjaman.filter(p => !['Menunggu', 'Disetujui', 'Ditolak', 'Diproses'].includes(p.status)).length
// //             },
// //             expired: expiredPeminjaman.length,
// //             needsUpdate: expiredPeminjaman.filter(p =>
// //                 p.status === 'Menunggu' || p.status === 'Diproses'
// //             ).length,
// //             details: allPeminjaman.map(p => {
// //                 const tanggalPeminjaman = new Date(p.tanggal_peminjaman);
// //                 let awalPeminjaman;
// //                 if (p.awal_peminjaman instanceof Date) {
// //                     awalPeminjaman = p.awal_peminjaman;
// //                 } else if (typeof p.awal_peminjaman === 'string') {
// //                     if (p.awal_peminjaman.includes('T')) {
// //                         awalPeminjaman = new Date(p.awal_peminjaman);
// //                     } else {
// //                         const [hours, minutes] = p.awal_peminjaman.split(':');
// //                         awalPeminjaman = new Date(tanggalPeminjaman);
// //                         awalPeminjaman.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
// //                     }
// //                 } else {
// //                     console.error(`Invalid awal_peminjaman format for peminjaman ${p._id}:`, p.awal_peminjaman);
// //                     awalPeminjaman = null;
// //                 }
// //                 const isExpired = awalPeminjaman && tanggalPeminjaman < now && awalPeminjaman < now;
// //                 return {
// //                     id: p._id,
// //                     status: p.status,
// //                     tanggal_peminjaman: p.tanggal_peminjaman,
// //                     awal_peminjaman: p.awal_peminjaman,
// //                     isExpired: isExpired,
// //                     needsUpdate: isExpired && (p.status === 'Menunggu' || p.status === 'Diproses')
// //                 };
// //             })
// //         };
// //     }

// //     res.json(results);
// // };

// // Jalankan fungsi ini secara berkala, misalnya setiap 5 menit
// const updateInterval = 3 * 60 * 1000; // 5 menit dalam milidetik
// setInterval(updateExpiredPeminjaman, updateInterval);

// module.exports = {
//   upload,
//   peminjamanHandler,
//   getPeminjamanAllHandler,
//   getPeminjamanByIdHandler,
//   extendPeminjamanHandler,
//   updateExpiredPeminjaman,
//   checkPeminjamanStatus,
// };

// ----------------------------------------------------------------------------------------------------------- //

// const extendPeminjamanHandler = async (req, res) => {
//     const { peminjamanId } = req.params;
//     const { newEndTime } = req.body;  // Menerima newEndTime dari request body
//     const { userId } = req.username;

//     try {
//         let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });
//         if (!peminjaman) {
//             peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//         }
//         if (!peminjaman) {
//             peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//         }

//         if (!peminjaman) {
//             return res.status(404).json({ message: 'Data peminjaman tidak ditemukan' });
//         }

//         // Cek jika peminjaman sudah disetujui dan dimulai
//         if (peminjaman.status !== 'Disetujui' || !peminjaman.isStarted) {
//             return res.status(400).json({ message: 'Peminjaman belum disetujui atau belum dimulai.' });
//         }

//         const now = new Date();
//         if (now > peminjaman.akhir_peminjaman) {
//             return res.status(400).json({ message: 'Peminjaman sudah berakhir' });
//         }

//         // Memeriksa apakah batas perpanjangan sudah tercapai
//         if (peminjaman.extended_count >= 2) {
//             return res.status(400).json({ message: 'Batas perpanjangan sudah tercapai' });
//         }

//         // Update waktu akhir_peminjaman di database
//         peminjaman.akhir_peminjaman = new Date(newEndTime);
//         peminjaman.extended_count += 1;
//         await peminjaman.save();

//         res.status(200).json({
//             success: true,
//             message: 'Waktu peminjaman berhasil diperpanjang',
//             data: peminjaman
//         });

//     } catch (err) {
//         console.error(err);
//         res.status(500).json({
//             success: false,
//             message: 'Terjadi kesalahan saat memperpanjang waktu peminjaman'
//         });
//     }
// };

// const extendPeminjamanHandler = async (req, res) => {
//     const { peminjamanId } = req.params;
//     const { newEndTime } = req.body;  // Menerima durasi waktu perpanjangan dalam menit
//     const { userId } = req.username;

//     // Tambahkan logging untuk memastikan request yang diterima benar
//     console.log('Menerima request extend dengan ID:', peminjamanId);
//     console.log('New End Time:', newEndTime);

//     try {
//         // Cari peminjaman berdasarkan ID dan user
//         let peminjaman = await Cnc.findOne({ _id: peminjamanId, user: userId });
//         if (!peminjaman) {
//             peminjaman = await Laser.findOne({ _id: peminjamanId, user: userId });
//         }
//         if (!peminjaman) {
//             peminjaman = await Printing.findOne({ _id: peminjamanId, user: userId });
//         }

//         if (!peminjaman) {
//             return res.status(404).json({ message: 'Data peminjaman tidak ditemukan' });
//         }

//         // Cek apakah peminjaman disetujui dan sudah dimulai
//         if (peminjaman.status !== 'Disetujui' || !peminjaman.isStarted) {
//             return res.status(400).json({ message: 'Peminjaman belum disetujui atau belum dimulai.' });
//         }

//         const now = new Date();
//         const currentEndTime = new Date(peminjaman.akhir_peminjaman);

//         // Pastikan peminjaman belum berakhir
//         if (now > currentEndTime) {
//             return res.status(400).json({ message: 'Peminjaman sudah berakhir' });
//         }

//         // Periksa apakah batas perpanjangan sudah tercapai
//         if (peminjaman.extended_count >= 2) {
//             return res.status(400).json({ message: 'Batas perpanjangan sudah tercapai' });
//         }

//         // Validasi bahwa newEndTime adalah angka dan lebih besar dari 0
//         if (isNaN(newEndTime) || newEndTime <= 0) {
//             return res.status(400).json({ message: 'Durasi perpanjangan tidak valid' });
//         }

//         // Tambahkan durasi perpanjangan ke akhir_peminjaman
//         const newEndTimeDate = new Date(currentEndTime.getTime() + newEndTime * 60000); // Tambahkan durasi perpanjangan dalam milidetik

//         // Update waktu akhir_peminjaman dan perpanjangan
//         peminjaman.akhir_peminjaman = newEndTimeDate;
//         peminjaman.extended_count += 1;
//         await peminjaman.save();

//         res.status(200).json({
//             success: true,
//             message: 'Waktu peminjaman berhasil diperpanjang',
//             data: peminjaman
//         });

//     } catch (err) {
//         console.error(err);
//         res.status(500).json({
//             success: false,
//             message: 'Terjadi kesalahan saat memperpanjang waktu peminjaman'
//         });
//     }
// };
