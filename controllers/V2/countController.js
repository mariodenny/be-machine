const Rental = require("../../models/rentalModel");
const Count = require("../../models/V2/countModel");

exports.updateRentalCount = async () => {
  const machines = await Machine.find();

  for (const machine of machines) {
    const disetujui = await Rental.countDocuments({ status: "Disetujui", machineId: machine._id });
    const ditolak = await Rental.countDocuments({ status: "Ditolak", machineId: machine._id });
    const menunggu = await Rental.countDocuments({ status: "Pending", machineId: machine._id });

    await Count.create({
      machineId: machine._id,
      disetujui,
      ditolak,
      menunggu,
      waktu: new Date(),
    });
  }

  console.log("✅ Snapshot per mesin berhasil disimpan");
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
        const {machineId} = req.params

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const now = new Date();

        const machines = await Machine.find();

        const reportPerMesin = [];

        for (const machine of machines) {
            const todayRentals = await Rental.find({
                machineId: machine._id,
                status: "Disetujui",
                createdAt: { $gte: today, $lte: now }
            });

            let totalTodayHours = 0;
            const usersTodaySet = new Set();

            todayRentals.forEach(r => {
                const start = new Date(r.awal_peminjaman);
                const end = new Date(r.akhir_peminjaman);
                const durasiJam = Math.abs(end - start) / 36e5;
                totalTodayHours += durasiJam;
                usersTodaySet.add(String(r.userId));
            });

            // Semua rentals (total sewa)
            const totalRentals = await Rental.find({
                machineId: machine._id,
                status: "Disetujui"
            });

            let totalAllHours = 0;
            totalRentals.forEach(r => {
                const start = new Date(r.awal_peminjaman);
                const end = new Date(r.akhir_peminjaman);
                const durasiJam = Math.abs(end - start) / 36e5;
                totalAllHours += durasiJam;
            });

            // Trend 7 hari per mesin
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(today.getDate() - 7);

            const trend = await Rental.aggregate([
                {
                    $match: {
                        machineId: machine._id,
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

            reportPerMesin.push({
                machineId: machine._id,
                machineName: machine.name,
                pemakaianHariIni: totalTodayHours,
                totalSewa: totalAllHours,
                penggunaHariIni: usersTodaySet.size,
                trend7Hari: trend
            });
        }

        res.json({
            success: true,
            data: reportPerMesin
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getCountByMachine = async (req, res) => {
  try {
    const { machineId } = req.params;

    const counts = await Count.find({ machineId }).sort({ waktu: -1 });
    res.status(200).json({ success: true, data: counts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};