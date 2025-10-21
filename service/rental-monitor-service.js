const cron = require('node-cron');

class RentalMonitorService {
    startMonitoring() {
        cron.schedule('*/30 * * * * *', async () => {
            await this.checkEndingRentals();
        });
        console.log('✅ Rental monitoring started');
    }

    async checkEndingRentals() {
        const now = new Date();
        const threeMinutesFromNow = new Date(now.getTime() + 3 * 60 * 1000);
        
        const endingRentals = await Rental.find({
            status: "Disetujui",
            isStarted: true,
            endTime: { 
                $lte: threeMinutesFromNow,
                $gt: now
            }
        }).populate("userId machineId");

        for (const rental of endingRentals) {
            await this.sendRentalEndingAlert(rental);
        }
    }

    async sendRentalEndingAlert(rental) {
        const user = rental.userId;
        const machine = rental.machineId;
        
        // KIRIM KE TOPIC USER
        await admin.messaging().send({
            notification: {
                title: `⏰ ${machine.name}`,
                body: `Peminjaman akan berakhir dalam 3 menit`
            },
            data: {
                type: 'RENTAL_ENDING',
                rentalId: rental._id.toString(),
                machineId: machine._id.toString(),
                machineName: machine.name
            },
            topic: `user_${user._id}`
        });

        console.log(`⏰ Rental ending alert sent for: ${machine.name}`);
    }
}

module.exports = new RentalMonitorService();