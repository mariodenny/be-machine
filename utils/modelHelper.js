// utils/modelHelper.js

const { Cnc, Laser, Printing } = require('../models/peminjamanModel');
const { CncSensor, LaserSensor, PrintingSensor } = require('../models/sensorModel');

const getModelByType = (type, context) => {
    console.log(`Type: ${type}, Context: ${context}`);

    const normalizedType = type.toLowerCase().trim();

    if (context === 'peminjaman') {
        switch (normalizedType) {
            case 'cnc':
            case 'cnc milling':
            case 'milling':
                return Cnc;
            case 'laser':
            case 'laser cutting':
            case 'lasercutting':
                return Laser;
            case 'printing':
            case '3d printing':
            case '3dprinting':
                return Printing;
            default:
                throw new Error(`Invalid type for peminjaman: ${type}`);
        }
    } else if (context === 'sensor') {
        switch (normalizedType) {
            case 'cnc':
            case 'cnc milling':
            case 'milling':
                return CncSensor;
            case 'laser':
            case 'laser cutting':
            case 'lasercutting':
                return LaserSensor;
            case 'printing':
            case '3d printing':
            case '3dprinting':
                return PrintingSensor;
            default:
                throw new Error(`Invalid type for sensor: ${type}`);
        }
    } else {
        throw new Error(`Invalid context: ${context}`);
    }
};

module.exports = { getModelByType };
