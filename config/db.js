const mongoose = require('mongoose');

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Berhasil terkoneksi ke MongoDb');
    } catch (error) {
        console.error('Gagal terkoneksi ke MongoDb', error.message);
        process.exit(1);
        
    }
}

module.exports = connectDb;