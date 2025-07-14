const Sensor = require("../../models/V2/sensorModel");
const Machine = require("../../models/machineModel");

exports.saveSensorData = async (req, res) => {
    const { machineId } = req.params;
    const { current, button, buzzerStatus } = req.body;

    try {
        const machine = await Machine.findById(machineId);
        if (!machine) {
            return res.status(404).json({ success: false, message: "Machine not found" });
        }

        const sensor = await Sensor.create({
            machineId,
            current,
            button,
            buzzerStatus,
            waktu: new Date(),
        });

        res.json({ success: true, data: sensor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
exports.updateRelayStatus = async (req, res) => {
    const { machineId } = req.params;
    const { buzzerStatus } = req.body;

    try {
        const sensor = await Sensor.findOneAndUpdate(
            { machineId },
            {
                buzzerStatus,
                lastBuzzerActivation: buzzerStatus ? new Date() : null,
            },
            { new: true, sort: { waktu: -1 } }
        );

        if (!sensor) {
            return res.status(404).json({ success: false, message: "Sensor not found" });
        }

        res.json({ success: true, data: sensor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getLatestSensorData = async (req, res) => {
    const { machineId } = req.params;

    try {
        const sensor = await Sensor.findOne({ machineId }).sort({ waktu: -1 });

        if (!sensor) {
            return res.status(404).json({ success: false, message: "Sensor not found" });
        }

        res.json({ success: true, data: sensor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// const mqtt = require("mqtt");
// const client = mqtt.connect("mqtt://broker.hivemq.com");

// exports.publishRelayCommand = async (req, res) => {
//     const { machineId } = req.params;
//     const { command } = req.body;

//     const topic = `machine/${machineId}/relay`;

//     client.publish(topic, JSON.stringify({ command }));

//     res.json({ success: true, topic, command });
// };

