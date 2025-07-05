// adminController.js

// adminController.js

const { checkAvailability } = require("../middleware/checkAvailability");
const { Cnc, Laser, Printing } = require("../models/peminjamanModel");
const {
  CncSensor,
  LaserSensor,
  PrintingSensor,
} = require("../models/sensorModel");
const User = require("../models/userModel");
const {
  sendStatusNotification,
} = require("../controllers/notificationController");

// Utility function untuk logging dengan timestamp
const logWithTimestamp = (message, data = null) => {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
};

// Helper function untuk mendapatkan model berdasarkan tipe
const getModelByType = (type) => {
  switch (type.toLowerCase()) {
    case "cnc":
      return Cnc;
    case "laser":
      return Laser;
    case "printing":
      return Printing;
    default:
      throw new Error(`Invalid machine type: ${type}`);
  }
};

// Helper function untuk mendapatkan sensor model berdasarkan tipe
const getSensorModelByType = (type) => {
  switch (type.toLowerCase()) {
    case "cnc":
      return CncSensor;
    case "laser":
      return LaserSensor;
    case "printing":
      return PrintingSensor;
    default:
      throw new Error(`Invalid sensor type: ${type}`);
  }
};

// Helper function untuk memproses waktu
function processTime(dateString, timeString) {
  if (!timeString || typeof timeString !== "string") {
    logWithTimestamp("Invalid time string received:", timeString);
    return null;
  }

  try {
    logWithTimestamp(`Processing time: ${timeString} for date: ${dateString}`);
    const [time, modifier] = timeString.split(" ");
    const [hoursStr, minutesStr, secondsStr] = time.split(":");

    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    const seconds = secondsStr ? parseInt(secondsStr, 10) : 0;

    if (modifier.toLowerCase() === "pm" && hours !== 12) {
      hours += 12;
    }
    if (modifier.toLowerCase() === "am" && hours === 12) {
      hours = 0;
    }

    const date = new Date(dateString);
    date.setHours(hours, minutes, seconds, 0);

    logWithTimestamp(`Processed time result:`, date);
    return date;
  } catch (error) {
    logWithTimestamp("Error processing time:", error);
    return null;
  }
}

const handlePeminjaman = {
  // Get all peminjaman data
  getPeminjamanAll: async (req, res) => {
    const userId = req.user.userId;
    const { type } = req.params;

    logWithTimestamp(`Request for ${type} peminjaman data from:`, {
      userId,
      email: req.user.email,
      role: req.user.role,
    });

    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can view all peminjaman.",
        });
      }

      const Model = getModelByType(type);
      const peminjamanForm = await Model.find()
        .populate("user", "username email")
        .sort({ createdAt: -1 });

      if (!peminjamanForm || peminjamanForm.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No peminjaman data found",
          data: [],
        });
      }

      // Sort based on status priority
      peminjamanForm.sort((a, b) => {
        const statusPriority = {
          Menunggu: 0,
          Disetujui: 1,
          Ditolak: 2,
        };
        return statusPriority[a.status] - statusPriority[b.status];
      });

      const responseData = peminjamanForm.map((item) => ({
        id: item._id,
        user: item.user
          ? {
              id: item.user._id,
              username: item.user.username,
              email: item.user.email,
            }
          : null,
        nama_pemohon: item.nama_pemohon || "Tidak ada nama",
        email: item.email || "Tidak ada email",
        tipe_pengguna: item.tipe_pengguna,
        nomor_identitas: item.nomor_identitas,
        asal_instansi: item.asal_instansi,
        tanggal_peminjaman: item.tanggal_peminjaman,
        awal_peminjaman: item.awal_peminjaman,
        akhir_peminjaman: item.akhir_peminjaman,
        jumlah: item.jumlah,
        program_studi: item.program_studi,
        kategori: item.kategori,
        detail_keperluan: item.detail_keperluan,
        desain_benda: item.desain_benda,
        status: item.status,
        waktu: item.waktu,
        alasan: item.alasan,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      }));

      return res.status(200).json({
        success: true,
        count: responseData.length,
        data: responseData,
      });
    } catch (error) {
      logWithTimestamp(`Error fetching ${type} data:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch peminjaman data",
        error: error.message,
      });
    }
  },

  // Get peminjaman by ID
  getPeminjamanById: async (req, res) => {
    const userId = req.user.userId;
    const { peminjamanId, type } = req.params;

    logWithTimestamp(`Request for peminjaman detail:`, {
      userId,
      peminjamanId,
      type,
    });

    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can view peminjaman details.",
        });
      }

      const Model = getModelByType(type);
      const peminjaman = await Model.findById(peminjamanId).populate(
        "user",
        "username email"
      );

      if (!peminjaman) {
        return res.status(404).json({
          success: false,
          message: "Peminjaman not found",
        });
      }

      const responseData = {
        id: peminjaman._id,
        user: peminjaman.user
          ? {
              id: peminjaman.user._id,
              username: peminjaman.user.username,
              email: peminjaman.user.email,
            }
          : null,
        nama_pemohon: peminjaman.nama_pemohon,
        email: peminjaman.email,
        tipe_pengguna: peminjaman.tipe_pengguna,
        nomor_identitas: peminjaman.nomor_identitas,
        asal_instansi: peminjaman.asal_instansi,
        tanggal_peminjaman: peminjaman.tanggal_peminjaman,
        awal_peminjaman: peminjaman.awal_peminjaman,
        akhir_peminjaman: peminjaman.akhir_peminjaman,
        jumlah: peminjaman.jumlah,
        program_studi: peminjaman.program_studi,
        kategori: peminjaman.kategori,
        detail_keperluan: peminjaman.detail_keperluan,
        desain_benda: peminjaman.desain_benda,
        status: peminjaman.status,
        waktu: peminjaman.waktu,
        alasan: peminjaman.alasan,
        created_at: peminjaman.createdAt,
        updated_at: peminjaman.updatedAt,
      };

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    } catch (error) {
      logWithTimestamp("Error fetching peminjaman detail:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch peminjaman detail",
        error: error.message,
      });
    }
  },

  // Approve peminjaman
  editDisetujui: async (req, res) => {
    const userId = req.user.userId;
    const { peminjamanId, type } = req.params;

    logWithTimestamp(`Approval request for peminjaman:`, {
      userId,
      peminjamanId,
      type,
    });

    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can approve peminjaman.",
        });
      }

      const Model = getModelByType(type);
      const peminjaman = await Model.findById(peminjamanId).populate(
        "user",
        "username email fcmToken"
      );

      if (!peminjaman) {
        return res.status(404).json({
          success: false,
          message: "Peminjaman not found",
        });
      }

      if (peminjaman.status === "Ditolak") {
        return res.status(400).json({
          success: false,
          message: "Cannot approve a rejected peminjaman",
        });
      }

      const isAvailable = await checkAvailability(
        Model,
        peminjaman.tanggal_peminjaman,
        peminjaman.awal_peminjaman,
        peminjaman.akhir_peminjaman,
        peminjamanId
      );

      if (!isAvailable) {
        return res.status(409).json({
          success: false,
          message: "Selected time slot is no longer available",
        });
      }

      peminjaman.status = "Disetujui";
      peminjaman.updated_at = new Date();
      await peminjaman.save();

      // Kirim notifikasi menggunakan fungsi baru
      if (peminjaman.user?.fcmToken) {
        const notificationResult = await sendStatusNotification(
          peminjaman.user,
          "Peminjaman Disetujui",
          `Peminjaman ${type} Anda telah disetujui`,
          {
            peminjamanId: peminjaman._id.toString(),
            machineType: type,
            status: "Disetujui",
          }
        );

        logWithTimestamp("Notification result:", notificationResult);
      }

      return res.status(200).json({
        success: true,
        message: "Peminjaman approved successfully",
        data: peminjaman,
      });
    } catch (error) {
      logWithTimestamp("Error approving peminjaman:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to approve peminjaman",
        error: error.message,
      });
    }
  },

  // Reject peminjaman
  editDitolak: async (req, res) => {
    const userId = req.user.userId;
    const { peminjamanId, type } = req.params;
    const { alasan } = req.body;

    logWithTimestamp(`Rejection request for peminjaman:`, {
      userId,
      peminjamanId,
      type,
      alasan,
    });

    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can reject peminjaman.",
        });
      }

      if (!alasan) {
        return res.status(400).json({
          success: false,
          message: "Rejection reason is required",
        });
      }

      const Model = getModelByType(type);
      const peminjaman = await Model.findById(peminjamanId).populate(
        "user",
        "username email fcmToken"
      );

      if (!peminjaman) {
        return res.status(404).json({
          success: false,
          message: "Peminjaman not found",
        });
      }

      if (peminjaman.status === "Disetujui") {
        return res.status(400).json({
          success: false,
          message: "Cannot reject an approved peminjaman",
        });
      }

      peminjaman.status = "Ditolak";
      peminjaman.alasan = alasan;
      peminjaman.updated_at = new Date();
      await peminjaman.save();

      // Kirim notifikasi menggunakan fungsi baru
      if (peminjaman.user?.fcmToken) {
        const notificationResult = await sendStatusNotification(
          peminjaman.user,
          "Peminjaman Ditolak",
          `Peminjaman ${type} Anda ditolak dikarenakan: ${alasan}`,
          {
            peminjamanId: peminjaman._id.toString(),
            machineType: type,
            status: "Ditolak",
            reason: alasan,
          }
        );

        logWithTimestamp("Notification result:", notificationResult);
      }

      return res.status(200).json({
        success: true,
        message: "Peminjaman rejected successfully",
        data: peminjaman,
      });
    } catch (error) {
      logWithTimestamp("Error rejecting peminjaman:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reject peminjaman",
        error: error.message,
      });
    }
  },

  // Delete peminjaman
  deletePeminjamanById: async (req, res) => {
    const userId = req.user.userId;
    const { peminjamanId, type } = req.params;

    logWithTimestamp(`Delete request for peminjaman:`, {
      userId,
      peminjamanId,
      type,
    });

    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can delete peminjaman.",
        });
      }

      const Model = getModelByType(type);
      const peminjaman = await Model.findByIdAndDelete(peminjamanId);

      if (!peminjaman) {
        return res.status(404).json({
          success: false,
          message: "Peminjaman not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Peminjaman deleted successfully",
      });
    } catch (error) {
      logWithTimestamp("Error deleting peminjaman:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete peminjaman",
        error: error.message,
      });
    }
  },

  // Get monitoring data
  getMonitoringData: async (req, res) => {
    const userId = req.user.userId;
    const { type } = req.params;

    console.log(
      `[${new Date().toISOString()}] Starting monitoring data request for type: ${type}`
    );

    try {
      // Authorization check
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Unauthorized. Only admin can access monitoring data.",
        });
      }

      const Model = getModelByType(type);

      // Helper function untuk menghitung durasi dalam jam
      const calculateDuration = (activatedTime, endTimeStr) => {
        const convertToSeconds = (timeStr) => {
          const [time, period] = timeStr.toLowerCase().split(" ");
          let [hours, minutes, seconds] = time.split(":").map(Number);

          // Konversi ke format 24 jam
          if (period === "pm" && hours !== 12) hours += 12;
          else if (period === "am" && hours === 12) hours = 0;

          return hours * 3600 + minutes * 60 + (seconds || 0);
        };

        const activatedDate = new Date(activatedTime);
        const activatedSeconds =
          activatedDate.getHours() * 3600 +
          activatedDate.getMinutes() * 60 +
          activatedDate.getSeconds();

        const endSeconds = convertToSeconds(endTimeStr);
        const durationInSeconds = endSeconds - activatedSeconds;

        console.log(`Duration calculation:
          Activated: ${activatedDate.toLocaleTimeString()}
          End time: ${endTimeStr}
          Duration (seconds): ${durationInSeconds}
        `);

        return durationInSeconds / 3600;
      };

      // Helper function untuk format durasi ke string
      const formatDuration = (hours) => {
        if (hours <= 0) return "0j 0m 0d";

        const totalSeconds = Math.round(hours * 3600); // Gunakan Math.round di sini
        const wholeHours = Math.floor(totalSeconds / 3600);
        const remainingSeconds = totalSeconds % 3600;
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = Math.round(remainingSeconds % 60); // Gunakan Math.round di sini

        return `${wholeHours}j ${minutes}m ${seconds}d`;
      };

      // const formatDuration = (hours) => {
      //   if (hours <= 0) return "0j 0m 0d";

      //   const totalSeconds = Math.abs(hours * 3600);
      //   const wholeHours = Math.floor(totalSeconds / 3600);
      //   const remainingSeconds = totalSeconds % 3600;
      //   const minutes = Math.floor(remainingSeconds / 60);
      //   const seconds = Math.floor(remainingSeconds % 60);

      //   return `${wholeHours}j ${minutes}m ${seconds}d`;
      // };

      // Helper function untuk parse tanggal dengan timezone yang konsisten
      const parseDate = (dateStr) => {
        // Format input: "Mon, 25 Nov 2024"
        const [dayName, fullDate] = dateStr.split(", ");
        const [day, month, year] = fullDate.split(" ");

        const monthMap = {
          Jan: 0,
          Feb: 1,
          Mar: 2,
          Apr: 3,
          May: 4,
          Jun: 5,
          Jul: 6,
          Aug: 7,
          Sep: 8,
          Oct: 9,
          Nov: 10,
          Dec: 11,
        };

        // Menggunakan UTC untuk konsistensi timezone
        return new Date(
          Date.UTC(parseInt(year), monthMap[month], parseInt(day))
        );
      };

      // Mendapatkan tanggal dengan timezone Asia/Jakarta
      const getJakartaDate = () => {
        // Dapatkan waktu saat ini
        const now = new Date();
        // console.log("Current UTC:", now.toISOString());

        // Gunakan formatter khusus untuk Jakarta
        const formatter = Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Jakarta",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        // Parse date parts
        const dateObj = {};
        formatter.formatToParts(now).forEach(({ type, value }) => {
          if (type !== "literal") dateObj[type] = value;
        });

        // Buat date string dalam format ISO
        const jakartaDateString = `${dateObj.year}-${dateObj.month}-${dateObj.day}T${dateObj.hour}:${dateObj.minute}:${dateObj.second}.000+07:00`;

        // Buat date object baru
        const jakartaDate = new Date(jakartaDateString);

        // console.log("Jakarta Date Details:", {
        //   originalString: jakartaDateString,
        //   date: jakartaDate.getDate(),
        //   month: jakartaDate.getMonth() + 1,
        //   year: jakartaDate.getFullYear(),
        //   hours: jakartaDate.getHours(),
        //   minutes: jakartaDate.getMinutes(),
        //   isoString: jakartaDate.toISOString(),
        // });

        return jakartaDate;
      };

      // Di tempat penggunaan date:
      const now = getJakartaDate();
      console.log("Using date:", now.toISOString());

      const today = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      );
      // console.log("Today date:", today.toISOString());

      // Untuk debugging groupPeminjamanByDate
      const targetDate = new Date(); // atau tanggal yang sedang diproses
      console.log("Target date for grouping:", {
        targetDateStr: targetDate.toISOString().split("T")[0],
        todayStr: getJakartaDate().toISOString().split("T")[0],
      });

      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const lastWeekStart = new Date(today);
      lastWeekStart.setDate(lastWeekStart.getDate() - 6);

      const lastMonthStart = new Date(today);
      lastMonthStart.setDate(lastMonthStart.getDate() - 29);

      // Get all activated peminjaman
      const allStartedPeminjaman = await Model.find({
        status: "Disetujui",
        isActivated: true,
        activatedAt: { $exists: true, $ne: null },
      }).populate("user", "username email");

      // Helper function untuk mengelompokkan peminjaman berdasarkan tanggal
      const groupPeminjamanByDate = (
        peminjaman,
        targetDate,
        dateEnd = null
      ) => {
        // Format tanggal target dan hari ini
        const targetDateStr = targetDate.toISOString().split("T")[0];
        const todayStr = getJakartaDate().toISOString().split("T")[0];

        // Khusus untuk today, gunakan waktu aktivasi
        if (targetDateStr === todayStr) {
          const startOfDay = new Date(todayStr + "T00:00:00.000Z");
          const endOfDay = new Date(todayStr + "T23:59:59.999Z");

          return peminjaman.filter((p) => {
            const aktivasiTime = new Date(p.activatedAt);
            return aktivasiTime >= startOfDay && aktivasiTime <= endOfDay;
          });
        }

        // Untuk tanggal lain dengan range
        if (dateEnd) {
          return peminjaman.filter((p) => {
            const peminjamanDate = parseDate(p.tanggal_peminjaman);
            const startDateUTC = new Date(
              Date.UTC(
                targetDate.getUTCFullYear(),
                targetDate.getUTCMonth(),
                targetDate.getUTCDate()
              )
            );
            const endDateUTC = new Date(
              Date.UTC(
                dateEnd.getUTCFullYear(),
                dateEnd.getUTCMonth(),
                dateEnd.getUTCDate(),
                23,
                59,
                59,
                999
              )
            );
            return (
              peminjamanDate >= startDateUTC && peminjamanDate <= endDateUTC
            );
          });
        }

        // Untuk tanggal lain tetap gunakan tanggal_peminjaman
        return peminjaman.filter((p) => {
          const peminjamanDate = parseDate(p.tanggal_peminjaman);
          const targetDateUTC = new Date(
            Date.UTC(
              targetDate.getUTCFullYear(),
              targetDate.getUTCMonth(),
              targetDate.getUTCDate()
            )
          );
          return peminjamanDate.getTime() === targetDateUTC.getTime();
        });
      };

      // Helper function untuk memproses statistik harian
      const processDailyStats = (peminjaman, dateStart, dateEnd) => {
        const dayPeminjaman = groupPeminjamanByDate(
          peminjaman,
          dateStart,
          dateEnd
        );

        let totalDuration = 0;
        const userCount = dayPeminjaman.length;

        dayPeminjaman.forEach((p) => {
          if (p.isActivated && p.activatedAt) {
            const duration = calculateDuration(
              p.activatedAt,
              p.akhir_peminjaman
            );
            totalDuration += duration;
          }
        });

        const userTypeStats = {
          mahasiswa: dayPeminjaman.filter(
            (p) => p.tipe_pengguna === "Mahasiswa"
          ).length,
          pekerja: dayPeminjaman.filter((p) => p.tipe_pengguna === "Pekerja")
            .length,
          pkl_magang: dayPeminjaman.filter((p) => p.tipe_pengguna === "PKL")
            .length,
          external: dayPeminjaman.filter((p) => p.tipe_pengguna === "Eksternal")
            .length,
        };

        return {
          totalDuration,
          formattedDuration: formatDuration(totalDuration),
          userCount,
          averageDuration: formatDuration(
            userCount > 0 ? totalDuration / userCount : 0
          ),
          byUserType: userTypeStats,
          detailedUsers: dayPeminjaman.map((p) => ({
            id: p._id,
            nama: p.nama_pemohon,
            waktuMulai: p.activatedAt,
            waktuSelesai: p.akhir_peminjaman,
            tipePengguna: p.tipe_pengguna,
          })),
        };
      };

      // Helper function untuk memproses statistik all time
      const processAllTimeStats = (peminjaman) => {
        let totalDuration = 0;
        const userCount = peminjaman.length;

        peminjaman.forEach((p) => {
          if (p.isActivated && p.activatedAt) {
            const duration = calculateDuration(
              p.activatedAt,
              p.akhir_peminjaman
            );
            totalDuration += duration;
          }
        });

        const userTypeStats = {
          mahasiswa: peminjaman.filter((p) => p.tipe_pengguna === "Mahasiswa")
            .length,
          pekerja: peminjaman.filter((p) => p.tipe_pengguna === "Pekerja")
            .length,
          pkl_magang: peminjaman.filter((p) => p.tipe_pengguna === "PKL")
            .length,
          external: peminjaman.filter((p) => p.tipe_pengguna === "Eksternal")
            .length,
        };

        return {
          totalDuration,
          formattedDuration: formatDuration(totalDuration),
          userCount,
          averageDurationPerUser: formatDuration(
            userCount > 0 ? totalDuration / userCount : 0
          ),
          byUserType: userTypeStats,
        };
      };

      // Calculate weekly trends
      const weeklyTrends = [];
      let currentDate = new Date(lastWeekStart);

      while (currentDate <= today) {
        const dayStart = new Date(currentDate);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        const dailyStats = processDailyStats(
          allStartedPeminjaman,
          dayStart,
          dayEnd
        );

        weeklyTrends.push({
          date: dayStart.toISOString().split("T")[0],
          stats: dailyStats,
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Calculate monthly trends
      const monthlyTrends = [];
      let weekStart = new Date(lastMonthStart);

      while (weekStart <= today) {
        // Set waktu awal minggu ke 00:00:00
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        // Set waktu akhir minggu ke 23:59:59
        weekEnd.setHours(23, 59, 59, 999);

        if (weekEnd > today) {
          weekEnd.setTime(today.getTime());
          weekEnd.setHours(23, 59, 59, 999);
        }
        // if (weekEnd > today) weekEnd.setTime(today.getTime());

        const weekStats = processDailyStats(
          allStartedPeminjaman,
          weekStart,
          weekEnd // Passing weekEnd sebagai parameter
        );

        monthlyTrends.push({
          startDate: weekStart.toISOString().split("T")[0],
          endDate: weekEnd.toISOString().split("T")[0],
          stats: weekStats,
        });

        weekStart.setDate(weekStart.getDate() + 7);
      }

      // Get today's stats using current date
      const todayPeminjaman = groupPeminjamanByDate(
        allStartedPeminjaman,
        today
      );
      const todayStats = processDailyStats(todayPeminjaman, today, endOfDay);

      // Get all-time stats
      const allTimeStats = processAllTimeStats(allStartedPeminjaman);

      // Prepare response with current Jakarta time
      const monitoringData = {
        success: true,
        type: type,
        date: getJakartaDate().toISOString().split("T")[0],
        stats: {
          today: {
            totalDuration: todayStats.formattedDuration,
            userCount: todayStats.userCount,
            activeUsers: todayStats.detailedUsers,
            byUserType: todayStats.byUserType,
          },
          all: {
            totalDuration: allTimeStats.formattedDuration,
            userCount: allTimeStats.userCount,
            averageDurationPerUser: allTimeStats.averageDurationPerUser,
            byUserType: allTimeStats.byUserType,
          },
        },
        trends: {
          weekly: {
            data: weeklyTrends,
            dateRange: {
              start: lastWeekStart.toISOString(),
              end: today.toISOString(),
            },
          },
          monthly: {
            data: monthlyTrends,
            dateRange: {
              start: lastMonthStart.toISOString(),
              end: today.toISOString(),
            },
          },
        },
        userDetails: allStartedPeminjaman
          .map((peminjaman) => ({
            id: peminjaman._id,
            nama: peminjaman.nama_pemohon,
            email: peminjaman.user?.email,
            tipe_pengguna: peminjaman.tipe_pengguna,
            nomor_identitas: peminjaman.nomor_identitas,
            kategori: peminjaman.kategori,
            detail_keperluan: peminjaman.detail_keperluan,
            durasi: formatDuration(
              calculateDuration(
                peminjaman.activatedAt,
                peminjaman.akhir_peminjaman
              )
            ),
            tanggal: peminjaman.tanggal_peminjaman,
            waktu_aktivasi: new Date(
              peminjaman.activatedAt
            ).toLocaleTimeString(),
            waktu_mulai: peminjaman.awal_peminjaman,
            waktu_selesai: peminjaman.akhir_peminjaman,
            status_aktif: "Sudah Dimulai",
          }))
          .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal)),
      };

      console.log(
        `[${new Date().toISOString()}] Successfully processed monitoring data`
      );
      return res.status(200).json(monitoringData);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to get monitoring data",
        error: error.message,
      });
    }
  },
};

// Export semua handler
module.exports = handlePeminjaman;

// -------------------------------------------------------------------------------------------------------------------- //

// getMonitoringData: async (req, res) => {
//   const userId = req.user.userId;
//   const { type } = req.params;

//   console.log(
//     `[${new Date().toISOString()}] Starting monitoring data request for type: ${type}`
//   );

//   try {
//     // Authorization check
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized. Only admin can access monitoring data.",
//       });
//     }

//     const Model = getModelByType(type);

//     // Helper function untuk menghitung durasi dalam jam
//     const calculateDuration = (activatedTime, endTimeStr) => {
//       const convertToSeconds = (timeStr) => {
//         const [time, period] = timeStr.toLowerCase().split(" ");
//         let [hours, minutes, seconds] = time.split(":").map(Number);

//         // Konversi ke format 24 jam
//         if (period === "pm" && hours !== 12) hours += 12;
//         else if (period === "am" && hours === 12) hours = 0;

//         return hours * 3600 + minutes * 60 + (seconds || 0);
//       };

//       const activatedDate = new Date(activatedTime);
//       const activatedSeconds =
//         activatedDate.getHours() * 3600 +
//         activatedDate.getMinutes() * 60 +
//         activatedDate.getSeconds();

//       const endSeconds = convertToSeconds(endTimeStr);
//       const durationInSeconds = endSeconds - activatedSeconds;

//       console.log(`Duration calculation:
//         Activated: ${activatedDate.toLocaleTimeString()}
//         End time: ${endTimeStr}
//         Duration (seconds): ${durationInSeconds}
//       `);

//       return durationInSeconds / 3600;
//     };

//     // Helper function untuk format durasi ke string
//     const formatDuration = (hours) => {
//       if (hours <= 0) return "0j 0m 0d";

//       const totalSeconds = Math.abs(hours * 3600);
//       const wholeHours = Math.floor(totalSeconds / 3600);
//       const remainingSeconds = totalSeconds % 3600;
//       const minutes = Math.floor(remainingSeconds / 60);
//       const seconds = Math.floor(remainingSeconds % 60);

//       return `${wholeHours}j ${minutes}m ${seconds}d`;
//     };

//     // Helper function untuk parse tanggal dengan timezone yang konsisten
//     const parseDate = (dateStr) => {
//       // Format input: "Mon, 25 Nov 2024"
//       const [dayName, fullDate] = dateStr.split(", ");
//       const [day, month, year] = fullDate.split(" ");

//       const monthMap = {
//         Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
//         Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
//       };

//       // Menggunakan UTC untuk konsistensi timezone
//       return new Date(Date.UTC(parseInt(year), monthMap[month], parseInt(day)));
//     };

//     // Set date ranges dengan UTC
//     const now = new Date();
//     const today = new Date(
//       Date.UTC(
//         now.getUTCFullYear(),
//         now.getUTCMonth(),
//         now.getUTCDate(),
//         now.getUTCHours(),
//         now.getUTCMinutes(),
//         now.getUTCSeconds()
//       )
//     );

//     const endOfDay = new Date(today);
//     endOfDay.setUTCHours(23, 59, 59, 999);

//     const lastWeekStart = new Date(today);
//     lastWeekStart.setUTCDate(today.getUTCDate() - 6);

//     const lastMonthStart = new Date(today);
//     lastMonthStart.setUTCDate(today.getUTCDate() - 29);

//     // Get all activated peminjaman
//     const allStartedPeminjaman = await Model.find({
//       status: "Disetujui",
//       isActivated: true,
//       activatedAt: { $exists: true, $ne: null },
//     }).populate("user", "username email");

//     // Helper function untuk mengelompokkan peminjaman berdasarkan tanggal
//     const groupPeminjamanByDate = (peminjaman, targetDate) => {
//       return peminjaman.filter((p) => {
//         const peminjamanDate = parseDate(p.tanggal_peminjaman);
//         const targetDateUTC = new Date(
//           Date.UTC(
//             targetDate.getUTCFullYear(),
//             targetDate.getUTCMonth(),
//             targetDate.getUTCDate()
//           )
//         );

//         return peminjamanDate.getTime() === targetDateUTC.getTime();
//       });
//     };

//     // Helper function untuk memproses statistik harian
//     const processDailyStats = (peminjaman, dateStart, dateEnd) => {
//       const dayPeminjaman = groupPeminjamanByDate(peminjaman, dateStart);

//       let totalDuration = 0;
//       const userCount = dayPeminjaman.length;

//       dayPeminjaman.forEach((p) => {
//         if (p.isActivated && p.activatedAt) {
//           const duration = calculateDuration(p.activatedAt, p.akhir_peminjaman);
//           totalDuration += duration;
//         }
//       });

//       const userTypeStats = {
//         mahasiswa: dayPeminjaman.filter((p) => p.tipe_pengguna === "Mahasiswa").length,
//         pekerja: dayPeminjaman.filter((p) => p.tipe_pengguna === "Pekerja").length,
//         pkl_magang: dayPeminjaman.filter((p) => p.tipe_pengguna === "PKL").length,
//         external: dayPeminjaman.filter((p) => p.tipe_pengguna === "Eksternal").length,
//       };

//       return {
//         totalDuration,
//         formattedDuration: formatDuration(totalDuration),
//         userCount,
//         averageDuration: formatDuration(userCount > 0 ? totalDuration / userCount : 0),
//         byUserType: userTypeStats,
//         detailedUsers: dayPeminjaman.map((p) => ({
//           id: p._id,
//           nama: p.nama_pemohon,
//           waktuMulai: p.activatedAt,
//           waktuSelesai: p.akhir_peminjaman,
//           tipePengguna: p.tipe_pengguna,
//         })),
//       };
//     };

//     // NEW: Helper function untuk memproses statistik all time
//     const processAllTimeStats = (peminjaman) => {
//       let totalDuration = 0;
//       const userCount = peminjaman.length;

//       // Hitung total durasi untuk semua peminjaman
//       peminjaman.forEach((p) => {
//         if (p.isActivated && p.activatedAt) {
//           const duration = calculateDuration(p.activatedAt, p.akhir_peminjaman);
//           totalDuration += duration;
//         }
//       });

//       // Hitung statistik berdasarkan tipe pengguna
//       const userTypeStats = {
//         mahasiswa: peminjaman.filter((p) => p.tipe_pengguna === "Mahasiswa").length,
//         pekerja: peminjaman.filter((p) => p.tipe_pengguna === "Pekerja").length,
//         pkl_magang: peminjaman.filter((p) => p.tipe_pengguna === "PKL").length,
//         external: peminjaman.filter((p) => p.tipe_pengguna === "Eksternal").length,
//       };

//       return {
//         totalDuration,
//         formattedDuration: formatDuration(totalDuration),
//         userCount,
//         averageDurationPerUser: formatDuration(userCount > 0 ? totalDuration / userCount : 0),
//         byUserType: userTypeStats,
//       };
//     };

//     // Calculate weekly trends
//     const weeklyTrends = [];
//     let currentDate = new Date(Date.UTC(
//       lastWeekStart.getUTCFullYear(),
//       lastWeekStart.getUTCMonth(),
//       lastWeekStart.getUTCDate()
//     ));

//     while (currentDate <= today) {
//       const dayStart = new Date(Date.UTC(
//         currentDate.getUTCFullYear(),
//         currentDate.getUTCMonth(),
//         currentDate.getUTCDate()
//       ));
//       const dayEnd = new Date(dayStart);
//       dayEnd.setUTCHours(23, 59, 59, 999);

//       const dailyPeminjaman = allStartedPeminjaman.filter((p) => {
//         const pDate = parseDate(p.tanggal_peminjaman);
//         const pDateNormalized = new Date(Date.UTC(
//           pDate.getUTCFullYear(),
//           pDate.getUTCMonth(),
//           pDate.getUTCDate()
//         ));
//         const dayStartNormalized = new Date(Date.UTC(
//           dayStart.getUTCFullYear(),
//           dayStart.getUTCMonth(),
//           dayStart.getUTCDate()
//         ));
//         return pDateNormalized.getTime() === dayStartNormalized.getTime();
//       });

//       const dailyStats = processDailyStats(dailyPeminjaman, dayStart, dayEnd);

//       weeklyTrends.push({
//         date: dayStart.toISOString().split("T")[0],
//         stats: dailyStats,
//       });

//       currentDate.setUTCDate(currentDate.getUTCDate() + 1);
//     }

//     // Calculate monthly trends
//     const monthlyTrends = [];
//     let weekStart = new Date(lastMonthStart);

//     while (weekStart <= today) {
//       const weekEnd = new Date(weekStart);
//       weekEnd.setDate(weekEnd.getDate() + 6);
//       if (weekEnd > today) weekEnd.setTime(today.getTime());

//       const weeklyPeminjaman = allStartedPeminjaman.filter((p) => {
//         const pDate = parseDate(p.tanggal_peminjaman);
//         return pDate >= weekStart && pDate <= weekEnd;
//       });

//       const weekStats = processDailyStats(weeklyPeminjaman, weekStart, weekEnd);

//       monthlyTrends.push({
//         startDate: weekStart.toISOString().split("T")[0],
//         endDate: weekEnd.toISOString().split("T")[0],
//         stats: weekStats,
//       });

//       weekStart.setDate(weekStart.getDate() + 7);
//     }

//     // Get today's stats
//     const todayPeminjaman = groupPeminjamanByDate(allStartedPeminjaman, today);
//     const todayStats = processDailyStats(todayPeminjaman, today, endOfDay);

//     // Get all-time stats using the new function
//     const allTimeStats = processAllTimeStats(allStartedPeminjaman);

//     // Prepare response
//     const monitoringData = {
//       success: true,
//       type: type,
//       date: now.toISOString().split("T")[0],
//       stats: {
//         today: {
//           totalDuration: todayStats.formattedDuration,
//           userCount: todayStats.userCount,
//           activeUsers: todayStats.detailedUsers,
//           byUserType: todayStats.byUserType,
//         },
//         all: {
//           totalDuration: allTimeStats.formattedDuration,
//           userCount: allTimeStats.userCount,
//           averageDurationPerUser: allTimeStats.averageDurationPerUser,
//           byUserType: allTimeStats.byUserType,
//         },
//       },
//       trends: {
//         weekly: {
//           data: weeklyTrends,
//           dateRange: {
//             start: lastWeekStart.toISOString(),
//             end: today.toISOString(),
//           },
//         },
//         monthly: {
//           data: monthlyTrends,
//           dateRange: {
//             start: lastMonthStart.toISOString(),
//             end: today.toISOString(),
//           },
//         },
//       },
//       userDetails: allStartedPeminjaman
//         .map((peminjaman) => ({
//           id: peminjaman._id,
//           nama: peminjaman.nama_pemohon,
//           email: peminjaman.user?.email,
//           tipe_pengguna: peminjaman.tipe_pengguna,
//           nomor_identitas: peminjaman.nomor_identitas,
//           kategori: peminjaman.kategori,
//           detail_keperluan: peminjaman.detail_keperluan,
//           durasi: formatDuration(
//             calculateDuration(peminjaman.activatedAt, peminjaman.akhir_peminjaman)
//           ),
//           tanggal: peminjaman.tanggal_peminjaman,
//           waktu_aktivasi: new Date(peminjaman.activatedAt).toLocaleTimeString(),
//           waktu_mulai: peminjaman.awal_peminjaman,
//           waktu_selesai: peminjaman.akhir_peminjaman,
//           status_aktif: "Sudah Dimulai",
//         }))
//         .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal)),
//     };

//     console.log(`[${new Date().toISOString()}] Successfully processed monitoring data`);
//     return res.status(200).json(monitoringData);

//   } catch (error) {
//     console.error(`[${new Date().toISOString()}] Error:`, error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to get monitoring data",
//       error: error.message,
//     });
//   }
// },

// --------------------------------------------------------------------------------------------------------------------------------------------------------------//
// Lanjutan getMonitoringData
// getMonitoringData: async (req, res) => {
//   const userId = req.user.userId;
//   const { type } = req.params;

//   console.log(
//     `[${new Date().toISOString()}] Starting monitoring data request for type: ${type}`
//   );

//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized. Only admin can access monitoring data.",
//       });
//     }

//     const Model = getModelByType(type);

//     // Set date ranges
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const startOfDay = new Date(today);
//     const endOfDay = new Date(today);
//     endOfDay.setHours(23, 59, 59, 999);

//     // Get ONLY started peminjaman
//     const allStartedPeminjaman = await Model.find({
//       status: "Disetujui",
//       isActivated: true,
//       activatedAt: { $exists: true, $ne: null },
//     }).populate("user", "username email");

//     console.log(
//       `[${new Date().toISOString()}] Found ${
//         allStartedPeminjaman.length
//       } started peminjaman`
//     );

//     // Log started peminjaman details
//     allStartedPeminjaman.forEach((p) => {
//       console.log(`[${new Date().toISOString()}] Started peminjaman:`, {
//         id: p._id.toString(),
//         nama: p.nama_pemohon,
//         isActivated: p.isActivated,
//         activatedAt: p.activatedAt,
//         tanggal: p.tanggal_peminjaman,
//         waktu_mulai: p.awal_peminjaman,
//         waktu_selesai: p.akhir_peminjaman,
//       });
//     });

//     // Initialize counters and arrays
//     let totalDurationToday = 0;
//     let totalDurationAll = 0;
//     let userCountToday = 0;
//     let userCountAll = 0;
//     const userDetails = [];
//     const activeUsers = [];

//     // Helper functions
//     function calculateDuration(activatedTime, endTimeStr) {
//       // Helper untuk konversi format waktu 12 jam ke detik
//       const convertToSeconds = (timeStr) => {
//         const [time, period] = timeStr.toLowerCase().split(" ");
//         let [hours, minutes, seconds] = time.split(":").map(Number);

//         // Konversi ke format 24 jam
//         if (period === "pm" && hours !== 12) {
//           hours += 12;
//         } else if (period === "am" && hours === 12) {
//           hours = 0;
//         }

//         // Konversi ke total detik
//         return hours * 3600 + minutes * 60 + (seconds || 0);
//       };

//       // Convert activatedTime ke detik
//       const activatedDate = new Date(activatedTime);
//       const activatedSeconds =
//         activatedDate.getHours() * 3600 +
//         activatedDate.getMinutes() * 60 +
//         activatedDate.getSeconds();

//       // Convert end time ke detik
//       const endSeconds = convertToSeconds(endTimeStr);

//       console.log(`Calculating duration:
//         Activated time: ${activatedDate.toLocaleTimeString()}
//         Activated seconds: ${activatedSeconds}
//         End time: ${endTimeStr}
//         End seconds: ${endSeconds}
//         Duration in seconds: ${endSeconds - activatedSeconds}`);

//       // Kembalikan dalam jam (untuk kompatibilitas dengan kode lain)
//       return (endSeconds - activatedSeconds) / 3600;
//     }

//     function formatDuration(hours) {
//       if (hours <= 0) return "0j 0m 0d";

//       // Konversi jam ke detik
//       const totalSeconds = Math.abs(hours * 3600);

//       // Ekstrak jam, menit, dan detik
//       const wholeHours = Math.floor(totalSeconds / 3600);
//       const remainingSeconds = totalSeconds % 3600;
//       const minutes = Math.floor(remainingSeconds / 60);
//       const seconds = Math.floor(remainingSeconds % 60);

//       // Format dengan leading zeros untuk menit dan detik
//       const formattedMinutes = String(minutes).padStart(1, "0");
//       const formattedSeconds = String(seconds).padStart(1, "0");

//       return `${wholeHours}j ${formattedMinutes}m ${formattedSeconds}d`;
//     }

//     function isToday(dateStr) {
//       const [dayName, rest] = dateStr.split(", ");
//       const [day, month, year] = rest.split(" ");
//       const today = new Date();
//       return (
//         parseInt(year) === today.getFullYear() &&
//         month === today.toLocaleString("en", { month: "short" }) &&
//         parseInt(day) === today.getDate()
//       );
//     }
//     // function calculateDuration(start, end) {
//     //   const parseTimeToMinutes = (timeStr) => {
//     //     const [time, period] = timeStr.toLowerCase().split(" ");
//     //     let [hours, minutes] = time.split(":").map(Number);

//     //     // Convert to 24-hour format
//     //     if (period === "pm" && hours !== 12) hours += 12;
//     //     if (period === "am" && hours === 12) hours = 0;

//     //     // Return total minutes
//     //     return hours * 60 + minutes;
//     //   };

//     //   const startMinutes = parseTimeToMinutes(start);
//     //   const endMinutes = parseTimeToMinutes(end);

//     //   // Convert back to hours for consistency with existing code
//     //   return (endMinutes - startMinutes) / 60;
//     // }
//     // // function calculateDuration(start, end) {
//     // //   const parseTime = (timeStr) => {
//     // //     const [time, period] = timeStr.toLowerCase().split(" ");
//     // //     let [hours, minutes] = time.split(":").map(Number);
//     // //     if (period === "pm" && hours !== 12) hours += 12;
//     // //     if (period === "am" && hours === 12) hours = 0;
//     // //     return hours + minutes / 60;
//     // //   };

//     // //   const startHours = parseTime(start);
//     // //   const endHours = parseTime(end);
//     // //   return endHours - startHours;
//     // // }

//     // function formatDuration(hours) {
//     //   if (hours <= 0) return "0j 0m";
//     //   const wholeHours = Math.floor(hours);
//     //   const minutes = Math.floor((hours - wholeHours) * 60);
//     //   return `${wholeHours}j ${minutes}m`;
//     // }

//     // function isToday(dateStr) {
//     //   const [dayName, rest] = dateStr.split(", ");
//     //   const [day, month, year] = rest.split(" ");
//     //   const today = new Date();
//     //   return (
//     //     parseInt(year) === today.getFullYear() &&
//     //     month === today.toLocaleString("en", { month: "short" }) &&
//     //     parseInt(day) === today.getDate()
//     //   );
//     // }

//     // Process started peminjaman only
//     // for (const peminjaman of allStartedPeminjaman) {
//     //   console.log(
//     //     `[${new Date().toISOString()}] Processing started peminjaman:`,
//     //     {
//     //       id: peminjaman._id.toString(),
//     //       nama: peminjaman.nama_pemohon,
//     //       tanggal: peminjaman.tanggal_peminjaman,
//     //     }
//     //   );

//     // const duration = calculateDuration(
//     //   peminjaman.awal_peminjaman,
//     //   peminjaman.akhir_peminjaman
//     // );
//     for (const peminjaman of allStartedPeminjaman) {
//       console.log(
//         `[${new Date().toISOString()}] Processing activated peminjaman:`,
//         {
//           id: peminjaman._id.toString(),
//           nama: peminjaman.nama_pemohon,
//           activatedAt: peminjaman.activatedAt,
//           tanggal: peminjaman.tanggal_peminjaman,
//         }
//       );

//       const duration = calculateDuration(
//         peminjaman.activatedAt,
//         peminjaman.akhir_peminjaman
//       );

//       const waktuAktivasi = new Date(peminjaman.activatedAt);
//       // Format waktu Indonesia (24 jam)
//       const formattedWaktuAktivasi = `${String(
//         waktuAktivasi.getHours()
//       ).padStart(2, "0")}:${String(waktuAktivasi.getMinutes()).padStart(
//         2,
//         "0"
//       )}:${String(waktuAktivasi.getSeconds()).padStart(2, "0")}`;

//       userDetails.push({
//         id: peminjaman._id,
//         nama: peminjaman.nama_pemohon,
//         email: peminjaman.user?.email,
//         tipe_pengguna: peminjaman.tipe_pengguna,
//         nomor_identitas: peminjaman.nomor_identitas,
//         asal_instansi: peminjaman.asal_instansi,
//         kategori: peminjaman.kategori,
//         detail_keperluan: peminjaman.detail_keperluan,
//         durasi: formatDuration(duration),
//         tanggal: peminjaman.tanggal_peminjaman,
//         waktu_aktivasi: formattedWaktuAktivasi,
//         waktu_mulai: peminjaman.awal_peminjaman,
//         waktu_selesai: peminjaman.akhir_peminjaman,
//         status_aktif: "Sudah Dimulai",
//       });

//       totalDurationAll += duration;
//       userCountAll++;

//       if (isToday(peminjaman.tanggal_peminjaman)) {
//         totalDurationToday += duration;
//         userCountToday++;
//         activeUsers.push({
//           id: peminjaman._id,
//           nama: peminjaman.nama_pemohon,
//           mulai: peminjaman.awal_peminjaman,
//           selesai: peminjaman.akhir_peminjaman,
//         });
//       }
//     }

//     const stats = {
//       today: {
//         totalDuration: formatDuration(totalDurationToday),
//         userCount: userCountToday,
//         activeUsers,
//         byUserType: {
//           mahasiswa: activeUsers.filter(
//             (u) => u.tipe_pengguna === "Mahasiswa"
//           ).length,
//           pekerja: activeUsers.filter((u) => u.tipe_pengguna === "Pekerja")
//             .length,
//           pkl_magang: activeUsers.filter((u) => u.tipe_pengguna === "PKL")
//             .length,
//           external: activeUsers.filter((u) => u.tipe_pengguna === "Eksternal")
//             .length,
//         },
//       },
//       all: {
//         totalDuration: formatDuration(totalDurationAll),
//         userCount: userCountAll,
//         averageDurationPerUser:
//           userCountAll > 0
//             ? formatDuration(totalDurationAll / userCountAll)
//             : "0j 0m",
//         byUserType: {
//           mahasiswa: userDetails.filter(
//             (u) => u.tipe_pengguna === "Mahasiswa"
//           ).length,
//           pekerja: userDetails.filter((u) => u.tipe_pengguna === "Pekerja")
//             .length,
//           pkl_magang: userDetails.filter((u) => u.tipe_pengguna === "PKL")
//             .length,
//           external: userDetails.filter((u) => u.tipe_pengguna === "Eksternal")
//             .length,
//         },
//       },
//     };

//     console.log(`[${new Date().toISOString()}] Final stats:`, {
//       startedPeminjaman: allStartedPeminjaman.length,
//       totalDurationAll,
//       userCountAll,
//     });

//     return res.status(200).json({
//       success: true,
//       type: type,
//       date: today.toISOString().split("T")[0],
//       stats,
//       userDetails: userDetails.sort(
//         (a, b) => new Date(b.tanggal) - new Date(a.tanggal)
//       ),
//     });
//   } catch (error) {
//     console.error(`[${new Date().toISOString()}] Error:`, error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to get monitoring data",
//       error: error.message,
//     });
//   }
// },
// getMonitoringData: async (req, res) => {
//   const userId = req.user.userId;
//   const { type } = req.params;

//   console.log(
//     `[${new Date().toISOString()}] Starting monitoring data request for type: ${type}`
//   );

//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized. Only admin can access monitoring data.",
//       });
//     }

//     const Model = getModelByType(type);

//     // Helper function untuk menghitung durasi dalam jam
//     const calculateDuration = (activatedTime, endTimeStr) => {
//       const convertToSeconds = (timeStr) => {
//         const [time, period] = timeStr.toLowerCase().split(" ");
//         let [hours, minutes, seconds] = time.split(":").map(Number);

//         if (period === "pm" && hours !== 12) hours += 12;
//         else if (period === "am" && hours === 12) hours = 0;

//         return hours * 3600 + minutes * 60 + (seconds || 0);
//       };

//       const activatedDate = new Date(activatedTime);
//       const activatedSeconds =
//         activatedDate.getHours() * 3600 +
//         activatedDate.getMinutes() * 60 +
//         activatedDate.getSeconds();

//       const endSeconds = convertToSeconds(endTimeStr);
//       const durationInSeconds = endSeconds - activatedSeconds;

//       console.log(`Duration calculation:
//         Activated: ${activatedDate.toLocaleTimeString()}
//         End time: ${endTimeStr}
//         Duration (seconds): ${durationInSeconds}
//       `);

//       return durationInSeconds / 3600;
//     };

//     // Helper function untuk format durasi
//     const formatDuration = (hours) => {
//       if (hours <= 0) return "0j 0m 0d";

//       const totalSeconds = Math.abs(hours * 3600);
//       const wholeHours = Math.floor(totalSeconds / 3600);
//       const remainingSeconds = totalSeconds % 3600;
//       const minutes = Math.floor(remainingSeconds / 60);
//       const seconds = Math.floor(remainingSeconds % 60);

//       return `${wholeHours}j ${minutes}m ${seconds}d`;
//     };

//     // Helper function untuk parse dan format tanggal dengan benar
//     const parseDate = (dateStr) => {
//       // Format input: "Mon, 25 Nov 2024"
//       const [dayName, fullDate] = dateStr.split(", ");
//       const [day, month, year] = fullDate.split(" ");

//       const monthMap = {
//         Jan: 0,
//         Feb: 1,
//         Mar: 2,
//         Apr: 3,
//         May: 4,
//         Jun: 5,
//         Jul: 6,
//         Aug: 7,
//         Sep: 8,
//         Oct: 9,
//         Nov: 10,
//         Dec: 11,
//       };

//       // Buat tanggal di timezone lokal
//       // return new Date(year, monthMap[month], parseInt(day));
//       return new Date(
//         Date.UTC(parseInt(year), monthMap[month], parseInt(day))
//       );
//     };

//     // Helper function untuk mendapatkan tanggal dari string tanggal_peminjaman
//     const getPeminjamanDate = (peminjaman) => {
//       const dateParts = peminjaman.tanggal_peminjaman
//         .split(",")[1]
//         .trim()
//         .split(" ");
//       const day = parseInt(dateParts[0]);
//       const month = dateParts[1]; // Nov
//       const year = parseInt(dateParts[2]);

//       const monthMap = {
//         Jan: 0,
//         Feb: 1,
//         Mar: 2,
//         Apr: 3,
//         May: 4,
//         Jun: 5,
//         Jul: 6,
//         Aug: 7,
//         Sep: 8,
//         Oct: 9,
//         Nov: 10,
//         Dec: 11,
//       };

//       return new Date(year, monthMap[month], day);
//     };

//     // Set date ranges
//     const now = new Date();
//     // const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
//     const today = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate(),
//       now.getHours(),
//       now.getMinutes(),
//       now.getSeconds()
//     );

//     console.log(
//       "\n[DEBUG] Date ranges:",
//       JSON.stringify(
//         {
//           now: now.toISOString(),
//           today: today.toISOString(),
//         },
//         null,
//         2
//       )
//     );

//     const endOfDay = new Date(today);
//     endOfDay.setHours(23, 59, 59, 999);

//     const lastWeekStart = new Date(today);
//     // lastWeekStart.setDate(lastWeekStart.getDate() - 6);
//     lastWeekStart.setDate(today.getDate() - 6);

//     const lastMonthStart = new Date(today);
//     // lastMonthStart.setDate(lastMonthStart.getDate() - 29);
//     lastMonthStart.setDate(today.getDate() - 29);

//     // Get all activated peminjaman
//     const allStartedPeminjaman = await Model.find({
//       status: "Disetujui",
//       isActivated: true,
//       activatedAt: { $exists: true, $ne: null },
//     }).populate("user", "username email");

//     console.log("\n[DEBUG] All started peminjaman:");
//     allStartedPeminjaman.forEach((p) => {
//       console.log(
//         JSON.stringify(
//           {
//             nama: p.nama_pemohon,
//             tanggal: p.tanggal_peminjaman,
//             activatedAt: p.activatedAt,
//             waktuMulai: p.awal_peminjaman,
//             waktuSelesai: p.akhir_peminjaman,
//           },
//           null,
//           2
//         )
//       );
//     });

//     // Helper function untuk mengelompokkan peminjaman berdasarkan tanggal
//     // const groupPeminjamanByDate = (peminjaman, targetDate) => {
//     //   return peminjaman.filter((p) => {
//     //     const pDate = getPeminjamanDate(p);
//     //     const tDate = new Date(targetDate);
//     //     return (
//     //       pDate.getFullYear() === tDate.getFullYear() &&
//     //       pDate.getMonth() === tDate.getMonth() &&
//     //       pDate.getDate() === tDate.getDate()
//     //     );
//     //   });
//     // };

//     // Helper function untuk mengelompokkan peminjaman
//     const groupPeminjamanByDate = (peminjaman, targetDate) => {
//       return peminjaman.filter((p) => {
//         const peminjamanDate = parseDate(p.tanggal_peminjaman);
//         // Convert target date to UTC for consistent comparison
//         const targetDateUTC = new Date(
//           Date.UTC(
//             targetDate.getFullYear(),
//             targetDate.getMonth(),
//             targetDate.getDate()
//           )
//         );

//         // Both dates are now in UTC, so comparison will be accurate
//         return peminjamanDate.getTime() === targetDateUTC.getTime();
//       });
//     };

//     // Process daily stats
//     const processDailyStats = (peminjaman, dateStart, dateEnd) => {
//       const dayPeminjaman = groupPeminjamanByDate(peminjaman, dateStart);

//       let totalDuration = 0;
//       const userCount = dayPeminjaman.length;

//       dayPeminjaman.forEach((p) => {
//         if (p.isActivated && p.activatedAt) {
//           const duration = calculateDuration(
//             p.activatedAt,
//             p.akhir_peminjaman
//           );
//           totalDuration += duration;
//         }
//       });

//       const userTypeStats = {
//         mahasiswa: dayPeminjaman.filter(
//           (p) => p.tipe_pengguna === "Mahasiswa"
//         ).length,
//         pekerja: dayPeminjaman.filter((p) => p.tipe_pengguna === "Pekerja")
//           .length,
//         pkl_magang: dayPeminjaman.filter((p) => p.tipe_pengguna === "PKL")
//           .length,
//         external: dayPeminjaman.filter((p) => p.tipe_pengguna === "Eksternal")
//           .length,
//       };

//       return {
//         totalDuration,
//         formattedDuration: formatDuration(totalDuration),
//         userCount,
//         averageDuration: formatDuration(
//           userCount > 0 ? totalDuration / userCount : 0
//         ),
//         byUserType: userTypeStats,
//         detailedUsers: dayPeminjaman.map((p) => ({
//           id: p._id,
//           nama: p.nama_pemohon,
//           waktuMulai: p.activatedAt,
//           waktuSelesai: p.akhir_peminjaman,
//           tipePengguna: p.tipe_pengguna,
//         })),
//       };
//     };

//     // Calculate weekly trends
//     // const weeklyTrends = [];
//     // let currentDate = new Date(lastWeekStart);

//     // while (currentDate <= today) {
//     //   const dayStart = new Date(
//     //     currentDate.getFullYear(),
//     //     currentDate.getMonth(),
//     //     currentDate.getDate()
//     //   );
//     //   const dayEnd = new Date(dayStart);
//     //   dayEnd.setHours(23, 59, 59, 999);

//     const weeklyTrends = [];
//     let currentDate = new Date(
//       Date.UTC(
//         lastWeekStart.getFullYear(),
//         lastWeekStart.getMonth(),
//         lastWeekStart.getDate()
//       )
//     );

//     while (currentDate <= today) {
//       const dayStart = new Date(
//         Date.UTC(
//           currentDate.getFullYear(),
//           currentDate.getMonth(),
//           currentDate.getDate()
//         )
//       );
//       const dayEnd = new Date(dayStart);
//       dayEnd.setUTCHours(23, 59, 59, 999);

//       // Use the normalized dates for comparison
//       const dailyPeminjaman = allStartedPeminjaman.filter((p) => {
//         const pDate = parseDate(p.tanggal_peminjaman);
//         const pDateNormalized = new Date(
//           pDate.getFullYear(),
//           pDate.getMonth(),
//           pDate.getDate()
//         );
//         const dayStartNormalized = new Date(
//           dayStart.getFullYear(),
//           dayStart.getMonth(),
//           dayStart.getDate()
//         );
//         return pDateNormalized.getTime() === dayStartNormalized.getTime();
//       });

//       const dailyStats = processDailyStats(dailyPeminjaman, dayStart, dayEnd);

//       weeklyTrends.push({
//         date: dayStart.toISOString().split("T")[0],
//         stats: dailyStats,
//       });

//       // currentDate.setDate(currentDate.getDate() + 1);
//       currentDate.setUTCDate(currentDate.getUTCDate() + 1);
//     }

//     // Calculate monthly trends
//     const monthlyTrends = [];
//     let weekStart = new Date(lastMonthStart);

//     while (weekStart <= today) {
//       const weekEnd = new Date(weekStart);
//       weekEnd.setDate(weekEnd.getDate() + 6);
//       if (weekEnd > today) weekEnd.setTime(today.getTime());

//       const weeklyPeminjaman = allStartedPeminjaman.filter((p) => {
//         const pDate = getPeminjamanDate(p);
//         return pDate >= weekStart && pDate <= weekEnd;
//       });

//       const weekStats = processDailyStats(
//         weeklyPeminjaman,
//         weekStart,
//         weekEnd
//       );

//       monthlyTrends.push({
//         startDate: weekStart.toISOString().split("T")[0],
//         endDate: weekEnd.toISOString().split("T")[0],
//         stats: weekStats,
//       });

//       weekStart.setDate(weekStart.getDate() + 7);
//     }

//     // Get today's stats
//     const todayPeminjaman = groupPeminjamanByDate(
//       allStartedPeminjaman,
//       today
//     );
//     const todayStats = processDailyStats(todayPeminjaman, today, endOfDay);

//     console.log(
//       "\n[DEBUG] Today's peminjaman:",
//       JSON.stringify(
//         {
//           date: today.toISOString(),
//           peminjaman: todayPeminjaman.map((p) => ({
//             nama: p.nama_pemohon,
//             tanggal: p.tanggal_peminjaman,
//           })),
//         },
//         null,
//         2
//       )
//     );

//     // Get all-time stats
//     const allTimeStats = processDailyStats(
//       allStartedPeminjaman,
//       new Date(0),
//       now
//     );

//     // Prepare response
//     const monitoringData = {
//       success: true,
//       type: type,
//       date: now.toISOString().split("T")[0],
//       stats: {
//         today: {
//           totalDuration: todayStats.formattedDuration,
//           userCount: todayStats.userCount,
//           activeUsers: todayStats.detailedUsers,
//           byUserType: todayStats.byUserType,
//         },
//         all: {
//           totalDuration: allTimeStats.formattedDuration,
//           userCount: allTimeStats.userCount,
//           averageDurationPerUser: allTimeStats.averageDuration,
//           byUserType: allTimeStats.byUserType,
//         },
//       },
//       trends: {
//         weekly: {
//           data: weeklyTrends,
//           dateRange: {
//             start: lastWeekStart.toISOString(),
//             end: today.toISOString(),
//           },
//         },
//         monthly: {
//           data: monthlyTrends,
//           dateRange: {
//             start: lastMonthStart.toISOString(),
//             end: today.toISOString(),
//           },
//         },
//       },
//       userDetails: allStartedPeminjaman
//         .map((peminjaman) => ({
//           id: peminjaman._id,
//           nama: peminjaman.nama_pemohon,
//           email: peminjaman.user?.email,
//           tipe_pengguna: peminjaman.tipe_pengguna,
//           nomor_identitas: peminjaman.nomor_identitas,
//           kategori: peminjaman.kategori,
//           detail_keperluan: peminjaman.detail_keperluan,
//           durasi: formatDuration(
//             calculateDuration(
//               peminjaman.activatedAt,
//               peminjaman.akhir_peminjaman
//             )
//           ),
//           tanggal: peminjaman.tanggal_peminjaman,
//           waktu_aktivasi: new Date(
//             peminjaman.activatedAt
//           ).toLocaleTimeString(),
//           waktu_mulai: peminjaman.awal_peminjaman,
//           waktu_selesai: peminjaman.akhir_peminjaman,
//           status_aktif: "Sudah Dimulai",
//         }))
//         .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal)),
//     };

//     console.log(
//       `[${new Date().toISOString()}] Successfully processed monitoring data`
//     );
//     console.log("\n[DEBUG] Final response date:", monitoringData.date);

//     // Debug final groupings
//     console.log(
//       "\n[DEBUG] Final groupings:",
//       JSON.stringify(
//         {
//           todayCount: todayStats.userCount,
//           weeklyData: weeklyTrends.map((w) => ({
//             date: w.date,
//             userCount: w.stats.userCount,
//             users: w.stats.detailedUsers.map((u) => u.nama),
//           })),
//         },
//         null,
//         2
//       )
//     );
//     return res.status(200).json(monitoringData);
//   } catch (error) {
//     console.error(`[${new Date().toISOString()}] Error:`, error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to get monitoring data",
//       error: error.message,
//     });
//   }
// },
// ------------------------------------------------------------------------------------------------------------------------------------------------- //
// getMonitoringData: async (req, res) => {
//   const userId = req.user.userId;
//   const { type } = req.params;

//   console.log(
//     `[${new Date().toISOString()}] Starting monitoring data request for type: ${type}`
//   );

//   try {
//     // Check admin authorization
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized. Only admin can access monitoring data.",
//       });
//     }

//     const Model = getModelByType(type);

//     // Set date ranges for different periods
//     const now = new Date();

//     // Today's range
//     const today = new Date(now);
//     today.setHours(0, 0, 0, 0);
//     const endOfDay = new Date(today);
//     endOfDay.setHours(23, 59, 59, 999);

//     // Last 7 days range
//     const lastWeekStart = new Date(today);
//     lastWeekStart.setDate(lastWeekStart.getDate() - 6); // -6 to include today

//     // Last 30 days range for monthly trends
//     const lastMonthStart = new Date(today);
//     lastMonthStart.setDate(lastMonthStart.getDate() - 29); // -29 to include today

//     // Get all activated peminjaman
//     const allStartedPeminjaman = await Model.find({
//       status: "Disetujui",
//       isActivated: true,
//       activatedAt: { $exists: true, $ne: null },
//     }).populate("user", "username email");

//     console.log(
//       `[${new Date().toISOString()}] Found ${allStartedPeminjaman.length} started peminjaman`
//     );

//     // Helper function to calculate duration in hours
//     const calculateDuration = (activatedTime, endTimeStr) => {
//       const convertToSeconds = (timeStr) => {
//         const [time, period] = timeStr.toLowerCase().split(" ");
//         let [hours, minutes, seconds] = time.split(":").map(Number);

//         if (period === "pm" && hours !== 12) hours += 12;
//         else if (period === "am" && hours === 12) hours = 0;

//         return hours * 3600 + minutes * 60 + (seconds || 0);
//       };

//       const activatedDate = new Date(activatedTime);
//       const activatedSeconds =
//         activatedDate.getHours() * 3600 +
//         activatedDate.getMinutes() * 60 +
//         activatedDate.getSeconds();

//       const endSeconds = convertToSeconds(endTimeStr);
//       const durationInSeconds = endSeconds - activatedSeconds;

//       console.log(`Duration calculation:
//         Activated: ${activatedDate.toLocaleTimeString()}
//         End time: ${endTimeStr}
//         Duration (seconds): ${durationInSeconds}
//       `);

//       return durationInSeconds / 3600; // Convert to hours
//     };

//     // Helper function to format duration
//     const formatDuration = (hours) => {
//       if (hours <= 0) return "0j 0m 0d";

//       const totalSeconds = Math.abs(hours * 3600);
//       const wholeHours = Math.floor(totalSeconds / 3600);
//       const remainingSeconds = totalSeconds % 3600;
//       const minutes = Math.floor(remainingSeconds / 60);
//       const seconds = Math.floor(remainingSeconds % 60);

//       return `${wholeHours}j ${minutes}m ${seconds}d`;
//     };

//     // Process daily stats for trends
//     const processDailyStats = (peminjaman, dateStart, dateEnd) => {
//       const dayPeminjaman = peminjaman.filter(p => {
//         const activatedDate = new Date(p.activatedAt);
//         return activatedDate >= dateStart && activatedDate <= dateEnd;
//       });

//       let totalDuration = 0;
//       const userCount = dayPeminjaman.length;

//       dayPeminjaman.forEach(p => {
//         const duration = calculateDuration(p.activatedAt, p.akhir_peminjaman);
//         totalDuration += duration;
//       });

//       // Get user type breakdown
//       const userTypeStats = {
//         mahasiswa: dayPeminjaman.filter(p => p.tipe_pengguna === "Mahasiswa").length,
//         pekerja: dayPeminjaman.filter(p => p.tipe_pengguna === "Pekerja").length,
//         pkl_magang: dayPeminjaman.filter(p => p.tipe_pengguna === "PKL").length,
//         external: dayPeminjaman.filter(p => p.tipe_pengguna === "Eksternal").length,
//       };

//       // Calculate average duration per user
//       const avgDurationPerUser = userCount > 0 ? totalDuration / userCount : 0;

//       return {
//         totalDuration,
//         formattedDuration: formatDuration(totalDuration),
//         userCount,
//         averageDuration: formatDuration(avgDurationPerUser),
//         byUserType: userTypeStats,
//         detailedUsers: dayPeminjaman.map(p => ({
//           id: p._id,
//           nama: p.nama_pemohon,
//           waktuMulai: p.activatedAt,
//           waktuSelesai: p.akhir_peminjaman,
//           tipePengguna: p.tipe_pengguna,
//         }))
//       };
//     };

//     // Calculate weekly trends
//     const weeklyTrends = [];
//     let currentDate = new Date(lastWeekStart);

//     while (currentDate <= today) {
//       const dayStart = new Date(currentDate);
//       const dayEnd = new Date(currentDate);
//       dayEnd.setHours(23, 59, 59, 999);

//       const dailyStats = processDailyStats(allStartedPeminjaman, dayStart, dayEnd);

//       weeklyTrends.push({
//         date: dayStart.toISOString().split('T')[0],
//         stats: dailyStats
//       });

//       currentDate.setDate(currentDate.getDate() + 1);
//     }

//     // Calculate monthly trends (group by week)
//     const monthlyTrends = [];
//     let weekStart = new Date(lastMonthStart);

//     while (weekStart <= today) {
//       const weekEnd = new Date(weekStart);
//       weekEnd.setDate(weekEnd.getDate() + 6);
//       if (weekEnd > today) weekEnd.setTime(today.getTime());

//       const weekStats = processDailyStats(allStartedPeminjaman, weekStart, weekEnd);

//       monthlyTrends.push({
//         startDate: weekStart.toISOString().split('T')[0],
//         endDate: weekEnd.toISOString().split('T')[0],
//         stats: weekStats
//       });

//       weekStart.setDate(weekStart.getDate() + 7);
//     }

//     // Get today's stats
//     const todayStats = processDailyStats(allStartedPeminjaman, today, endOfDay);

//     // Get all-time stats
//     const allTimeStats = processDailyStats(
//       allStartedPeminjaman,
//       new Date(0), // beginning of time
//       now
//     );

//     // Prepare response
//     const monitoringData = {
//       success: true,
//       type: type,
//       date: today.toISOString().split("T")[0],
//       stats: {
//         today: {
//           totalDuration: todayStats.formattedDuration,
//           userCount: todayStats.userCount,
//           activeUsers: todayStats.detailedUsers,
//           byUserType: todayStats.byUserType
//         },
//         all: {
//           totalDuration: allTimeStats.formattedDuration,
//           userCount: allTimeStats.userCount,
//           averageDurationPerUser: allTimeStats.averageDuration,
//           byUserType: allTimeStats.byUserType
//         }
//       },
//       trends: {
//         weekly: {
//           data: weeklyTrends,
//           dateRange: {
//             start: lastWeekStart.toISOString(),
//             end: today.toISOString()
//           }
//         },
//         monthly: {
//           data: monthlyTrends,
//           dateRange: {
//             start: lastMonthStart.toISOString(),
//             end: today.toISOString()
//           }
//         }
//       },
//       userDetails: allStartedPeminjaman.map(peminjaman => ({
//         id: peminjaman._id,
//         nama: peminjaman.nama_pemohon,
//         email: peminjaman.user?.email,
//         tipe_pengguna: peminjaman.tipe_pengguna,
//         nomor_identitas: peminjaman.nomor_identitas,
//         kategori: peminjaman.kategori,
//         detail_keperluan: peminjaman.detail_keperluan,
//         durasi: formatDuration(
//           calculateDuration(peminjaman.activatedAt, peminjaman.akhir_peminjaman)
//         ),
//         tanggal: peminjaman.tanggal_peminjaman,
//         waktu_aktivasi: new Date(peminjaman.activatedAt).toLocaleTimeString(),
//         waktu_mulai: peminjaman.awal_peminjaman,
//         waktu_selesai: peminjaman.akhir_peminjaman,
//         status_aktif: "Sudah Dimulai"
//       })).sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal))
//     };

//     console.log(`[${new Date().toISOString()}] Successfully processed monitoring data`);
//     return res.status(200).json(monitoringData);

//   } catch (error) {
//     console.error(`[${new Date().toISOString()}] Error:`, error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to get monitoring data",
//       error: error.message
//     });
//   }
// }
// ------------------------------------------------------------------------------------------------------------------------------------------- //

// getMonitoringData: async (req, res) => {
//   const userId = req.user.userId;
//   const { type } = req.params;

//   logWithTimestamp(`Monitoring data request:`, {
//     userId,
//     type,
//     email: req.user.email,
//     role: req.user.role,
//   });

//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized. Only admin can access monitoring data.",
//       });
//     }

//     const Model = getModelByType(type);
//     const SensorModel = getSensorModelByType(type);

//     // Set date ranges
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const startOfDay = new Date(today);
//     const endOfDay = new Date(today);
//     endOfDay.setHours(23, 59, 59, 999);

//     // Get approved peminjaman
//     const allApprovedPeminjaman = await Model.find({
//       status: "Disetujui",
//     }).populate("user", "username email");

//     // Get sensor data for today
//     const sensorDataToday = await SensorModel.find({
//       waktu: {
//         $gte: startOfDay,
//         $lte: endOfDay,
//       },
//       button: true,
//     });

//     // Initialize counters and arrays
//     let totalDurationToday = 0;
//     let totalDurationAll = 0;
//     let userCountToday = 0;
//     let userCountAll = 0;
//     const userDetails = [];
//     const activeUsers = [];

//     // Process each peminjaman
//     for (const peminjaman of allApprovedPeminjaman) {
//       logWithTimestamp("Processing peminjaman:", {
//         id: peminjaman._id,
//         user: peminjaman.user?.username,
//         tanggal: peminjaman.tanggal_peminjaman,
//       });

//       const tanggalPeminjaman = new Date(peminjaman.tanggal_peminjaman);
//       const awalPeminjaman = processTime(
//         peminjaman.tanggal_peminjaman,
//         peminjaman.awal_peminjaman
//       );
//       const akhirPeminjaman = processTime(
//         peminjaman.tanggal_peminjaman,
//         peminjaman.akhir_peminjaman
//       );

//       if (!awalPeminjaman || !akhirPeminjaman) {
//         logWithTimestamp(
//           "Invalid time format for peminjaman:",
//           peminjaman._id
//         );
//         continue;
//       }

//       // Calculate duration in hours
//       const duration = (akhirPeminjaman - awalPeminjaman) / (1000 * 60 * 60);

//       if (isNaN(duration) || duration <= 0) {
//         logWithTimestamp("Invalid duration for peminjaman:", peminjaman._id);
//         continue;
//       }

//       // Update total counts
//       totalDurationAll += duration;
//       userCountAll++;

//       // Add to user details
//       userDetails.push({
//         id: peminjaman._id,
//         nama: peminjaman.nama_pemohon,
//         email: peminjaman.user?.email,
//         tipe_pengguna: peminjaman.tipe_pengguna,
//         nomor_identitas: peminjaman.nomor_identitas,
//         asal_instansi: peminjaman.asal_instansi,
//         kategori: peminjaman.kategori,
//         detail_keperluan: peminjaman.detail_keperluan,
//         durasi: `${Math.floor(duration)}j ${Math.floor(
//           (duration % 1) * 60
//         )}m`,
//         tanggal: peminjaman.tanggal_peminjaman,
//         waktu_mulai: peminjaman.awal_peminjaman,
//         waktu_selesai: peminjaman.akhir_peminjaman,
//       });

//       // Check if peminjaman is active today
//       const isToday =
//         tanggalPeminjaman.toDateString() === today.toDateString();
//       const hasStartedToday = sensorDataToday.some(
//         (sensor) =>
//           sensor.waktu >= awalPeminjaman && sensor.waktu <= akhirPeminjaman
//       );

//       if (isToday && hasStartedToday) {
//         totalDurationToday += duration;
//         userCountToday++;
//         activeUsers.push({
//           id: peminjaman._id,
//           nama: peminjaman.nama_pemohon,
//           mulai: peminjaman.awal_peminjaman,
//           selesai: peminjaman.akhir_peminjaman,
//         });
//       }
//     }

//     // Prepare statistics
//     const stats = {
//       today: {
//         totalDuration: `${Math.floor(totalDurationToday)}j ${Math.floor(
//           (totalDurationToday % 1) * 60
//         )}m`,
//         userCount: userCountToday,
//         activeUsers,
//         byUserType: {
//           mahasiswa: activeUsers.filter(
//             (u) => u.tipe_pengguna === "Mahasiswa"
//           ).length,
//           pekerja: activeUsers.filter((u) => u.tipe_pengguna === "Pekerja")
//             .length,
//           pkl_magang: activeUsers.filter(
//             (u) => u.tipe_pengguna === "PKL"
//           ).length,
//           external: activeUsers.filter((u) => u.tipe_pengguna === "Eksternal")
//             .length,
//         },
//       },
//       all: {
//         totalDuration: `${Math.floor(totalDurationAll)}j ${Math.floor(
//           (totalDurationAll % 1) * 60
//         )}m`,
//         userCount: userCountAll,
//         averageDurationPerUser:
//           userCountAll > 0
//             ? `${Math.floor(totalDurationAll / userCountAll)}j ${Math.floor(
//                 ((totalDurationAll / userCountAll) % 1) * 60
//               )}m`
//             : "0j 0m",
//         byUserType: {
//           mahasiswa: userDetails.filter(
//             (u) => u.tipe_pengguna === "Mahasiswa"
//           ).length,
//           pekerja: userDetails.filter((u) => u.tipe_pengguna === "Pekerja")
//             .length,
//           pkl_magang: userDetails.filter(
//             (u) => u.tipe_pengguna === "PKL"
//           ).length,
//           external: userDetails.filter((u) => u.tipe_pengguna === "Eksternal")
//             .length,
//         },
//       },
//     };

//     return res.status(200).json({
//       success: true,
//       type: type,
//       date: today.toISOString().split("T")[0],
//       stats,
//       userDetails: userDetails.sort(
//         (a, b) => new Date(b.tanggal) - new Date(a.tanggal)
//       ),
//     });
//   } catch (error) {
//     logWithTimestamp("Error getting monitoring data:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to get monitoring data",
//       error: error.message,
//     });
//   }
// },

// ---------------------------------------------------------------------------------------------------- //
// const { checkAvailability } = require('../middleware/checkAvailability');
// const { Cnc, Laser, Printing } = require('../models/peminjamanModel');
// const { CncSensor, LaserSensor, PrintingSensor } = require('../models/sensorModel');
// const User = require('../models/userModel');

// const getModelByType = (type) => {
//     switch(type) {
//         case 'cnc':
//             return Cnc;
//         case 'laser':
//             return Laser;
//         case 'printing':
//             return Printing;
//         default:
//             throw new Error('Invalid type parameter');
//     }
// };

// const getSensorModelByType = (type) => {
//     switch(type) {
//         case 'cnc':
//             return CncSensor;
//         case 'laser':
//             return LaserSensor;
//         case 'printing':
//             return PrintingSensor;
//         default:
//             throw new Error('Invalid type parameter');
//     }
// };

// // function processTime(dateString, timeString) {
// //     const date = new Date(dateString);
// //     const [time, modifier] = timeString.split(' ');
// //     let [hours, minutes, seconds] = time.split(':');

// //     if (modifier.toLowerCase() === 'pm' && hours !== '12') {
// //         hours = parseInt(hours, 10) + 12;
// //     } else if (modifier.toLowerCase() === 'am' && hours === '12') {
// //         hours = '00';
// //     }

// //     date.setHours(parseInt(hours, 10), parseInt(minutes, 10), parseInt(seconds, 10));
// //     return date;
// // };

// // Perbaiki fungsi processTime di adminController.js
// // function processTime(dateString, timeString) {
// //     if (!timeString || typeof timeString !== 'string') {
// //         console.error('Invalid or undefined timeString:', timeString);
// //         return null;
// //     }

// //     const date = new Date(dateString);
// //     const [time, modifier] = timeString.split(' ');
// //     let [hours, minutes] = time.split(':');

// //     if (modifier.toLowerCase() === 'pm' && hours !== '12') {
// //         hours = parseInt(hours, 10) + 12;
// //     } else if (modifier.toLowerCase() === 'am' && hours === '12') {
// //         hours = '00';
// //     }

// //     date.setHours(parseInt(hours, 10), parseInt(minutes, 10));
// //     return date;
// // }

// function processTime(dateString, timeString) {
//     if (!timeString || typeof timeString !== 'string') {
//         console.error('Invalid or undefined timeString:', timeString);
//         return null;
//     }

//     try {
//         console.log(`Converting time string: ${timeString} with date: ${dateString}`);
//         const [time, modifier] = timeString.split(' ');
//         const [hoursStr, minutesStr, secondsStr] = time.split(':');

//         let hours = parseInt(hoursStr, 10);
//         const minutes = parseInt(minutesStr, 10);
//         const seconds = secondsStr ? parseInt(secondsStr, 10) : 0;

//         // Konversi ke format 24 jam
//         if (modifier.toLowerCase() === "pm" && hours !== 12) {
//             hours += 12;
//         }
//         if (modifier.toLowerCase() === "am" && hours === 12) {
//             hours = 0;
//         }

//         const date = new Date(dateString);
//         date.setHours(hours, minutes, seconds, 0);

//         console.log(`Converted time: ${date}`);
//         return date;
//     } catch (error) {
//         console.error("Error in processTime:", error);
//         return null;
//     }
// }

// const handlePeminjaman = {
//     getPeminjamanAll: async (req, res) => {
//         const { userId } = req.username;
//         const { type } = req.params;

//         console.log(`Received request for type: ${type}`);  // Logging untuk memastikan type benar

//         try {
//             const user = await User.findOne({
//                 _id: userId,
//                 role: "admin",
//             });

//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can approve peminjaman.",
//                 });
//             }

//             console.log(`Admin ${userId} is requesting ${type} data`);

//             const Model = getModelByType(type);
//             const peminjamanForm = await Model.find();

//             if (!peminjamanForm || peminjamanForm.length === 0) {
//                 return res.status(404).json({ message: 'Data tidak ditemukan' });
//             }

//             peminjamanForm.sort((a, b) => {
//                 if (a.status === 'Menunggu' && (b.status === 'Disetujui' || b.status === 'Ditolak')) return -1;
//                 if ((a.status === 'Disetujui' || a.status === 'Ditolak') && b.status === 'Menunggu') return 1;
//                 return 0;
//             });

//             const responseData = peminjamanForm.map(item => ({
//                 id: item._id,
//                 nama_pemohon: item.nama_pemohon || 'Tidak ada nama',
//                 email: item.email || 'Tidak ada email',
//                 tanggal_peminjaman: item.tanggal_peminjaman || 'Tidak diatur',
//                 awal_peminjaman: item.awal_peminjaman || 'Tidak diatur',
//                 akhir_peminjaman: item.akhir_peminjaman || 'Tidak diatur',
//                 jumlah: item.jumlah || 'Tidak diatur',
//                 program_studi: item.program_studi || 'Tidak diatur',
//                 kategori: item.kategori || 'Tidak diatur',
//                 detail_keperluan: item.detail_keperluan || 'Tidak ada detail',
//                 desain_benda: item.desain_benda || 'Tidak ada desain',
//                 status: item.status || 'Tidak diketahui',
//                 waktu: item.waktu || 'Tidak diatur',
//             }));

//             res.status(200).json({
//                 success: true,
//                 statusCode: res.statusCode,
//                 data: responseData,
//             });

//         } catch (err) {
//             console.error(`Error fetching ${type} data for admin ${userId}:`, err);
//             res.status(500).json({ error: err.message });
//         }
//     },

//     getPeminjamanById: async (req, res) => {
//         const { userId } = req.username;
//         const { peminjamanId, type } = req.params;

//         try {
//             // Cek apakah user memiliki role admin
//             const user = await User.findOne({
//                 _id: userId,
//                 role: "admin",
//             });

//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can approve peminjaman.",
//                 });
//             }

//             // Pilih model yang sesuai berdasarkan tipe
//             const Model = getModelByType(type);

//             // Cari peminjaman berdasarkan ID
//             const peminjaman = await Model.findById(peminjamanId);
//             console.log(peminjaman); // Tambahkan log untuk melihat apakah data ditemukan

//             if (!peminjaman) {
//                 return res.status(404).json({ message: 'Data tidak ditemukan' });
//             }

//             // Siapkan data yang akan dikirim sebagai respons
//             const responseData = {
//                 id: peminjaman._id,
//                 email: peminjaman.email,
//                 nama_pemohon: peminjaman.nama_pemohon,
//                 tanggal_peminjaman: peminjaman.tanggal_peminjaman,
//                 awal_peminjaman: peminjaman.awal_peminjaman,
//                 akhir_peminjaman: peminjaman.akhir_peminjaman,
//                 jumlah: peminjaman.jumlah,
//                 program_studi: peminjaman.program_studi,
//                 kategori: peminjaman.kategori,
//                 detail_keperluan: peminjaman.detail_keperluan,
//                 desain_benda: peminjaman.desain_benda,
//                 status: peminjaman.status,
//                 waktu: peminjaman.waktu,
//             };

//             res.status(200).json({
//                 success: true,
//                 statusCode: res.statusCode,
//                 data: responseData,
//             });

//         } catch (err) {
//             console.error(err);
//             res.status(500).json({ error: err.message });
//         }
//     },

//     editDisetujui: async (req, res) => {
//         const { userId } = req.username;
//         const { peminjamanId, type } = req.params;

//         try {
//             const user = await User.findOne({
//                 _id: userId,
//                 role: "admin",
//             });

//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can approve peminjaman.",
//                 });
//             }

//             const Model = getModelByType(type);
//             const formEdit = await Model.findById(peminjamanId);

//             if (!formEdit) {
//                 return res.status(404).json({
//                     success: false,
//                     message: "not found.",
//                 });
//             }

//             if (formEdit.status === "Ditolak") {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Peminjaman has already been rejected and cannot be approved.",
//                 });
//             }

//             console.log('Peminjaman data for approval:', {
//                 tanggal_peminjaman: formEdit.tanggal_peminjaman,
//                 awal_peminjaman: formEdit.awal_peminjaman,
//                 akhir_peminjaman: formEdit.akhir_peminjaman
//             });

//             const isAvailable = await checkAvailability(
//                 Model,
//                 formEdit.tanggal_peminjaman,
//                 formEdit.awal_peminjaman,
//                 formEdit.akhir_peminjaman,
//                 peminjamanId
//             );

//             if (!isAvailable) {
//                 return res.status(409).json({
//                     success: false,
//                     message: "The requested time slot is no longer available.",
//                 });
//             }

//             formEdit.status = "Disetujui";
//             await formEdit.save();

//             res.status(200).json({
//                 success: true,
//                 message: "Peminjaman status updated to Disetujui.",
//                 data: formEdit,
//             });
//         } catch (error) {
//             console.error('Error updating peminjaman status:', error);
//             res.status(500).json({
//                 success: false,
//                 message: "Error updating peminjaman status.",
//             });
//         }
//     },

//     editDitolak: async (req, res) => {
//         const { userId } = req.username;
//         const { peminjamanId, type } = req.params;
//         const { alasan } = req.body;

//         try {
//             const user = await User.findOne({
//                 _id: userId,
//                 role: "admin",
//             });

//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can reject peminjaman.",
//                 });
//             }

//             const Model = getModelByType(type);
//             const formEdit = await Model.findById(peminjamanId);

//             if (!formEdit) {
//                 return res.status(404).json({
//                     success: false,
//                     message: "Peminjaman not found.",
//                 });
//             }

//             if (formEdit.status === "Disetujui") {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Peminjaman has already been approved and cannot be rejected.",
//                 });
//             }

//             if (formEdit.status === "Ditolak") {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Peminjaman has already been rejected and cannot be approved.",
//                 });
//             }

//             if (!alasan) {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Reason for rejection is required.",
//                 });
//             }

//             formEdit.status = "Ditolak";
//             formEdit.alasan = alasan;
//             await formEdit.save();

//             res.status(200).json({
//                 success: true,
//                 message: "Peminjaman status updated to Ditolak.",
//                 data: formEdit,
//             });
//         } catch (error) {
//             console.error('Error updating peminjaman status:', error);
//             res.status(500).json({
//                 success: false,
//                 message: "Error updating peminjaman status.",
//             });
//         }
//     },

//     deletePeminjamanById: async (req, res) => {
//         const { userId } = req.username;
//         const { peminjamanId, type } = req.params;

//         try {
//             const user = await User.findOne({
//                 _id: userId,
//                 role: "admin",
//             });

//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can delete peminjaman.",
//                 });
//             }

//             const Model = getModelByType(type);
//             const peminjaman = await Model.findByIdAndDelete(peminjamanId);

//             if (!peminjaman) {
//                 return res.status(404).json({
//                     success: false,
//                     message: "Peminjaman not found.",
//                 });
//             }

//             res.status(200).json({
//                 success: true,
//                 message: "Peminjaman deleted successfully.",
//             });

//         } catch (err) {
//             console.error(`Error deleting peminjaman for admin ${userId}:`, err);
//             res.status(500).json({ error: err.message });
//         }
//     },

//     getMonitoringData: async (req, res) => {
//         const { userId } = req.username;
//         const { type } = req.params;
//         const Model = getModelByType(type);
//         const SensorModel = getSensorModelByType(type);
//         const today = new Date();
//         today.setHours(0, 0, 0, 0);

//         console.log(`Request received for monitoring data: ${type} by user: ${userId}`);

//         try {
//             const user = await User.findOne({ _id: userId, role: "admin" });
//             if (!user) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Unauthorized. Only admin can access monitoring data.",
//                 });
//             }

//             const allApprovedPeminjaman = await Model.find({ status: 'Disetujui' });

//             const startOfDay = new Date(today);
//             const endOfDay = new Date(today);
//             endOfDay.setHours(23, 59, 59, 999);

//             let totalDurationToday = 0;
//             let totalDurationAll = 0;
//             let userCountToday = 0;
//             let userCountAll = 0;
//             const userDetails = [];

//             const sensorDataToday = await SensorModel.find({
//                 waktu: { $gte: startOfDay, $lte: endOfDay },
//                 button: true
//             });

//             for (const peminjaman of allApprovedPeminjaman) {
//                 console.log(`Processing peminjaman: ${peminjaman._id}`);
//                 console.log(`Tanggal Peminjaman: ${peminjaman.tanggal_peminjaman}`);
//                 console.log(`Awal Peminjaman: ${peminjaman.awal_peminjaman}`);
//                 console.log(`Akhir Peminjaman: ${peminjaman.akhir_peminjaman}`);

//                 const tanggalPeminjaman = new Date(peminjaman.tanggal_peminjaman);

//                 // Periksa apakah awal_peminjaman dan akhir_peminjaman adalah timestamp atau string waktu
//                 const awalPeminjaman = processTime(peminjaman.tanggal_peminjaman, peminjaman.awal_peminjaman);
//                 const akhirPeminjaman = processTime(peminjaman.tanggal_peminjaman, peminjaman.akhir_peminjaman);

//                 let duration = (akhirPeminjaman - awalPeminjaman) / (1000 * 60 * 60); // dalam jam

//                 console.log(`Calculated duration: ${duration} hours`);

//                 if (!isNaN(duration) && duration > 0) {
//                     totalDurationAll += duration;
//                     userCountAll++;

//                     userDetails.push({
//                         nama: peminjaman.nama_pemohon,
//                         kategori: peminjaman.kategori,
//                         detail_keperluan: peminjaman.detail_keperluan,
//                         durasi: `${Math.floor(duration)}j ${Math.floor((duration % 1) * 60)}m`
//                     });

//                     const isToday = tanggalPeminjaman.toDateString() === today.toDateString();
//                     const hasStartedToday = sensorDataToday.some(sensor =>
//                         sensor.waktu >= awalPeminjaman && sensor.waktu <= akhirPeminjaman
//                     );

//                     if (isToday && hasStartedToday) {
//                         totalDurationToday += duration;
//                         userCountToday++;
//                     }
//                 }
//             }

//             res.status(200).json({
//                 success: true,
//                 data: {
//                     totalDurationToday: `${Math.floor(totalDurationToday)}j ${Math.floor((totalDurationToday % 1) * 60)}m`,
//                     totalDurationAll: `${Math.floor(totalDurationAll)}j ${Math.floor((totalDurationAll % 1) * 60)}m`,
//                     userCountToday,
//                     userCountAll,
//                     userDetails
//                 }
//             });

//         } catch (error) {
//             console.error('Error getting monitoring data:', error);
//             res.status(500).json({
//                 success: false,
//                 message: "Error getting monitoring data.",
//             });
//         }
//     },

// };

// module.exports = handlePeminjaman;

// ---------------------------------------------------------------------------------------------------- //

// getMonitoringData: async (req, res) => {
//     const { userId } = req.username;
//     const { type } = req.params;
//     const Model = getModelByType(type);
//     const SensorModel = getSensorModelByType(type);
//     const today = new Date();
//     today.setHours(0, 0, 0, 0); // Set to midnight for consistent day comparison

//     console.log(`Request received for monitoring data: ${type} by user: ${userId}`);

//     try {
//         const user = await User.findOne({
//             _id: userId,
//             role: "admin",
//         });

//         if (!user) {
//             console.log('Unauthorized access attempt detected.');
//             return res.status(403).json({
//                 success: false,
//                 message: "Unauthorized. Only admin can access monitoring data.",
//             });
//         }

//         // Ambil semua peminjaman yang disetujui untuk perhitungan total
//         const allApprovedPeminjaman = await Model.find({ status: 'Disetujui' });

//         // Tentukan awal dan akhir hari ini untuk filter
//         const startOfDay = new Date(today);
//         const endOfDay = new Date(today);
//         endOfDay.setHours(23, 59, 59, 999);  // Set to end of the day

//         console.log(`Start of Day: ${startOfDay}`);
//         console.log(`End of Day: ${endOfDay}`);

//         let totalDurationToday = 0;
//         let totalDurationAll = 0;
//         let userCountToday = 0;
//         let userCountAll = 0;
//         const userDetails = [];

//         // Ambil data sensor untuk melihat apakah tombol "Mulai Peminjaman" ditekan pada hari ini
//         const sensorDataToday = await SensorModel.find({ waktu: { $gte: startOfDay, $lte: endOfDay }, button: true });

//         // Loop over all approved peminjaman
//         for (const peminjaman of allApprovedPeminjaman) {
//             console.log(`Peminjaman ID: ${peminjaman._id}`);

//             // Pastikan `tanggal_peminjaman` adalah objek Date
//             const tanggalPeminjaman = new Date(peminjaman.tanggal_peminjaman);
//             const rawAwal = peminjaman.awal_peminjaman;
//             const rawAkhir = peminjaman.akhir_peminjaman;

//             const startTime = new Date(`${tanggalPeminjaman.toDateString()} ${rawAwal}`);
//             const endTime = new Date(`${tanggalPeminjaman.toDateString()} ${rawAkhir}`);

//             if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
//                 console.error(`Cannot parse dates: awal_peminjaman: ${startTime}, akhir_peminjaman: ${endTime}`);
//                 continue;
//             }

//             // Pastikan startTime tidak lebih besar dari endTime
//             if (startTime >= endTime) {
//                 console.error(`Invalid duration: startTime (${startTime}) is after endTime (${endTime})`);
//                 continue;
//             }

//             let duration = (endTime - startTime) / (1000 * 60 * 60); // dalam jam

//             console.log(`Calculated duration: ${duration} hours`);

//             if (!isNaN(duration) && duration > 0) {
//                 totalDurationAll += duration; // Tambahkan durasi ke total seluruh waktu
//                 userCountAll++; // Tambahkan pengguna ke total seluruh waktu

//                 userDetails.push({
//                     nama: peminjaman.nama_pemohon,
//                     kategori: peminjaman.kategori,
//                     detail_keperluan: peminjaman.detail_keperluan,
//                     durasi: `${Math.floor(duration)}j ${Math.floor((duration % 1) * 60)}m`
//                 });

//                 // Periksa apakah peminjaman dilakukan hari ini dan apakah tombol peminjaman ditekan hari ini
//                 if (
//                     startTime >= startOfDay &&
//                     startTime <= endOfDay &&
//                     sensorDataToday.some(sensor => sensor.waktu <= startTime)
//                 ) {
//                     totalDurationToday += duration;
//                     userCountToday++;
//                 }

//                 console.log(`Peminjaman processed: ${peminjaman.nama_pemohon}, Duration: ${duration}`);
//             } else {
//                 console.log('Skipping peminjaman due to invalid duration.');
//             }
//         }

//         console.log(`Total Duration Today: ${totalDurationToday} hours`);
//         console.log(`Total Duration All: ${totalDurationAll} hours`);
//         console.log(`User Count Today: ${userCountToday}`);
//         console.log(`User Count All: ${userCountAll}`);

//         res.status(200).json({
//             success: true,
//             data: {
//                 totalDurationToday: `${Math.floor(totalDurationToday)}j ${Math.floor((totalDurationToday % 1) * 60)}m`,
//                 totalDurationAll: `${Math.floor(totalDurationAll)}j ${Math.floor((totalDurationAll % 1) * 60)}m`,
//                 userCountToday,
//                 userCountAll,
//                 userDetails
//             }
//         });

//     } catch (error) {
//         console.error('Error getting monitoring data:', error);
//         res.status(500).json({
//             success: false,
//             message: "Error getting monitoring data.",
//         });
//     }
// },
