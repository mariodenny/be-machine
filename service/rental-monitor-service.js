const admin = require("firebase-admin");
const Rental =  require('../models/rentalModel')


async function checkEndingRentals() {
    const now = new Date();
    const threeMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000); // 3 menit
    
    // Cari rental yang mau habis
    const endingRentals = await Rental.find({
        status: "Disetujui",
        isStarted: true,
        endTime: { $lte: threeMinutesFromNow, $gt: now }
    }).populate("userId machineId");

    for (const rental of endingRentals) {
        const user = rental.userId;
        const machine = rental.machineId;
        
        if (!user.fcmToken) continue;

        // Kirim notif simple
        const message = {
            notification: {
                title: `⏰ ${machine.name}`,
                body: `Peminjaman mau habis dalam 3 menit`
            },
            data: {
                type: 'RENTAL_ENDING',
                machineId: machine._id.toString(),
                machineName: machine.name
            },
            token: user.fcmToken
        };

        await admin.messaging().send(message);
        console.log(`⏰ Notif rental ending ke: ${user.name}`);
    }
}