const mqtt = require("mqtt");
const Sensor = require("../../models/V2/sensorModel");
const Machine = require("../../models/machineModel");
const Notification = require("../../models/V2/notificationModel");
const admin = require("firebase-admin");

const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
});

client.on("connect", () => {
    console.log("✅ MQTT connected!");
    client.subscribe("machine/+/sensor");
});

client.on("message", async (topic, message) => {
    try {
        const parts = topic.split("/");
        const machineId = parts[1];
        const data = JSON.parse(message.toString());

        console.log(`📡 [${topic}]`, data);

        // Cek mesin valid
        const machine = await Machine.findById(machineId);
        if (!machine) return;

        // Simpan data sensor
        await Sensor.create({
            machineId: machineId,
            current: data.current,
            button: data.button,
            buzzerStatus: data.buzzerStatus,
            waktu: new Date(),
        });

        if (data.current < 5) {
            const rental = await Rental.findOne({
                machineId: machineId,
                status: "Disetujui",
            }).populate("userId");

            if (rental && rental.userId.fcmToken) {
                await admin.messaging().send({
                    token: rental.userId.fcmToken,
                    notification: {
                        title: "Peringatan Sensor",
                        body: `${machine.name} arus rendah!`,
                    },
                });

                await Notification.create({
                    userId: rental.userId._id,
                    title: "Peringatan Sensor",
                    body: `${machine.name} arus rendah!`,
                    type: "sensor_alert",
                    read: false,
                });
            }
        }
    } catch (err) {
        console.error(err);
    }
});
