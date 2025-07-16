const Rental = require("../../models/rentalModel");
const Count = require("../../models/V2/countModel");

exports.updateRentalCount = async () => {
    const disetujui = await Rental.countDocuments({ status: "Disetujui" });
    const ditolak = await Rental.countDocuments({ status: "Ditolak" });
    const menunggu = await Rental.countDocuments({ status: "Pending" });

    const snapshot = await Count.create({
        disetujui,
        ditolak,
        menunggu,
        waktu: new Date(),
    });

    console.log("Count snapshot created:", snapshot);
    return snapshot;
};

exports.getAllCounts = async (req, res) => {
    try {
        const counts = await Count.find().sort({ waktu: -1 });
        res.status(200).json({ success: true, data: counts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getUsageReport = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const now = new Date();

        // Pemakaian Hari Ini
        const rentalsToday = await Rental.find({
            createdAt: { $gte: today, $lte: now },
            status: "Disetujui"
        });

        let totalTodayHours = 0;
        rentalsToday.forEach(r => {
            const start = new Date(r.awal_peminjaman);
            const end = new Date(r.akhir_peminjaman);
            const durasiJam = Math.abs(end - start) / 36e5;
            totalTodayHours += durasiJam;
        });

        const uniqueUsersToday = await Rental.distinct("userId", {
            createdAt: { $gte: today, $lte: now },
            status: "Disetujui"
        });

        // Pemakaian Total
        const totalRentals = await Rental.find({ status: "Disetujui" });
        let totalAllHours = 0;
        totalRentals.forEach(r => {
            const start = new Date(r.awal_peminjaman);
            const end = new Date(r.akhir_peminjaman);
            const durasiJam = Math.abs(end - start) / 36e5;
            totalAllHours += durasiJam;
        });

        // Trend 7 Hari
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 7);

        const trend = await Rental.aggregate([
            {
                $match: {
                    createdAt: { $gte: sevenDaysAgo, $lte: now },
                    status: "Disetujui"
                }
            },
            {
                $project: {
                    date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    durasiJam: {
                        $divide: [
                            { $subtract: ["$akhir_peminjaman", "$awal_peminjaman"] },
                            1000 * 60 * 60
                        ]
                    },
                    userId: 1
                }
            },
            {
                $group: {
                    _id: "$date",
                    totalDurasiJam: { $sum: "$durasiJam" },
                    penggunaUnik: { $addToSet: "$userId" }
                }
            },
            {
                $project: {
                    date: "$_id",
                    totalDurasiJam: 1,
                    totalPengguna: { $size: "$penggunaUnik" },
                    _id: 0
                }
            },
            { $sort: { date: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                pemakaianHariIni: totalTodayHours,
                totalSewa: totalAllHours,
                penggunaHariIni: uniqueUsersToday.length,
                trend7Hari: trend
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};