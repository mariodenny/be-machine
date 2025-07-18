const Rental = require("../../models/rentalModel");
const Count = require("../../models/V2/countModel");
const Machine = require("../../models/machineModel")

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

exports.getCountByMachine = async (req, res) => {
  try {
    const { machineId } = req.params;

    const counts = await Count.find({ machineId }).sort({ waktu: -1 });
    res.status(200).json({ success: true, data: counts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getUsageReport = async (req, res) => {
  try {
    const { machineId } = req.params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const machineQuery = machineId ? { _id: machineId } : {};
    const machines = await Machine.find(machineQuery);

    const reportPerMesin = [];

    for (const machine of machines) {
      // Rentals hari ini
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

      // Prepare 7 days trend
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 6); // termasuk hari ini

      const trend7Hari = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        trend7Hari.push({
          date: dateStr,
          totalDurasiJam: 0,
          totalPengguna: 0,
        });
      }

      const sewa7Hari = await Rental.find({
        machineId: machine._id,
        status: "Disetujui",
        createdAt: { $gte: sevenDaysAgo, $lte: now }
      });

      sewa7Hari.forEach(r => {
        const awal = new Date(r.awal_peminjaman);
        const tglStr = awal.toISOString().split("T")[0];

        const hariTrend = trend7Hari.find(d => d.date === tglStr);
        if (hariTrend) {
          hariTrend.totalDurasiJam += 24; // sesuai revisi: fix 24 jam
          hariTrend.totalPengguna += 1;
        }
      });

      reportPerMesin.push({
        machineId: machine._id,
        machineName: machine.name,
        pemakaianHariIni: totalTodayHours,
        totalSewa: totalAllHours,
        penggunaHariIni: usersTodaySet.size,
        trend7Hari: trend7Hari
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