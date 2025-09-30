// sensor-seeder.js
const mongoose = require('mongoose');
const SensorV2 = require('../models/V2/sensorModel'); // Sesuaikan path
const Machine = require('../models/machineModel'); // Sesuaikan path

// Koneksi database
const connectDB = async () => {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/rental-app', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
};

// Pattern data realistis untuk setiap mesin
const machinePatterns = {
    'oven-hardening': {
        sensorType: 'suhu',
        baseValue: 800,
        fluctuation: 50,
        trend: 'cyclic',
        anomalyFrequency: 0.05
    },
    'mesin-frais-getaran': {
        sensorType: 'getaran',
        baseValue: 0.8,
        fluctuation: 0.6,
        trend: 'stable',
        anomalyFrequency: 0.08
    },
    'pneumatic-trainer': {
        sensorType: 'tekanan',
        baseValue: 5.0,
        fluctuation: 1.5,
        trend: 'cyclic',
        anomalyFrequency: 0.03
    },
    'motor-mesin-frais': {
        sensorType: 'suhu',
        baseValue: 45,
        fluctuation: 20,
        trend: 'increasing',
        anomalyFrequency: 0.06
    }
};

// Generate realistic sensor data
const generateSensorData = (machineType, hours = 24) => { // Kurangi jadi 24 jam untuk testing
    const pattern = machinePatterns[machineType];
    const data = [];

    const now = new Date();
    const baseTime = new Date(now.getTime() - (hours * 60 * 60 * 1000));

    for (let i = 0; i < hours; i++) {
        const timestamp = new Date(baseTime.getTime() + (i * 60 * 60 * 1000));

        // Base value dengan trend
        let baseValue = pattern.baseValue;

        // Apply trend
        if (pattern.trend === 'increasing') {
            baseValue += (i / hours) * pattern.fluctuation;
        } else if (pattern.trend === 'cyclic') {
            const cycle = Math.sin((i / 24) * Math.PI * 2);
            baseValue += cycle * (pattern.fluctuation / 2);
        }

        // Fluctuation normal
        const fluctuation = (Math.random() - 0.5) * pattern.fluctuation;
        let value = baseValue + fluctuation;

        // Chance of anomaly
        if (Math.random() < pattern.anomalyFrequency) {
            const anomalyType = Math.random() > 0.3 ? 'spike' : 'drop';
            const anomalyIntensity = pattern.fluctuation * (2 + Math.random() * 3);
            value = anomalyType === 'spike' ? value + anomalyIntensity : Math.max(0, value - anomalyIntensity);
        }

        // Ensure value within physical limits
        value = Math.max(0, value);

        data.push({
            machineType,
            sensorType: pattern.sensorType,
            value: parseFloat(value.toFixed(2)),
            timestamp,
            isAnomaly: value > (pattern.baseValue + pattern.fluctuation * 1.5)
        });
    }

    return data;
};

const getUnit = (sensorType) => {
    const units = {
        'suhu': '°C',
        'getaran': 'mm/s',
        'tekanan': 'bar',
        'current': 'A'
    };
    return units[sensorType] || '';
};

const determineMachineType = (machine) => {
    const name = machine.name.toLowerCase();
    if (name.includes('oven') || name.includes('hardening')) return 'oven-hardening';
    if (name.includes('frais') && name.includes('getaran')) return 'mesin-frais-getaran';
    if (name.includes('pneumatic')) return 'pneumatic-trainer';
    return 'motor-mesin-frais';
};

// Seed database dengan data realistis
const seedSensorData = async () => {
    try {
        console.log('Starting sensor data seeding...');

        // Clear existing data
        await SensorV2.deleteMany({});
        console.log('Cleared existing sensor data');

        const machines = await Machine.find();
        console.log(`Found ${machines.length} machines`);

        let totalRecords = 0;

        for (const machine of machines) {
            const machineType = determineMachineType(machine);
            console.log(`Seeding data for ${machine.name} (${machineType})`);

            // Generate 24 hours of data (bisa diganti ke 720 untuk 30 hari)
            const sensorData = generateSensorData(machineType, 24);

            const records = sensorData.map(data => ({
                machineId: machine._id,
                sensorType: data.sensorType,
                value: data.value,
                unit: getUnit(data.sensorType),
                waktu: data.timestamp,
                isValid: true,
                isAnomaly: data.isAnomaly
            }));

            await SensorV2.insertMany(records);
            totalRecords += records.length;

            console.log(`✅ Seeded ${records.length} records for ${machine.name}`);
        }

        console.log(`🎉 Seeding completed! Total records: ${totalRecords}`);

    } catch (error) {
        console.error('❌ Seeding error:', error);
    }
};

// Jalankan langsung
const runSeeder = async () => {
    await connectDB();
    await seedSensorData();
    mongoose.connection.close();
    console.log('Database connection closed');
};

// Run jika file dijalankan langsung
if (require.main === module) {
    runSeeder();
}

module.exports = { seedSensorData };