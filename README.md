# Pulsars Fitness

The Fitness tab tracks forearm movement while the XIAO ESP32C3 cuff is connected to the laptop over USB. The month calendar shows tracked days and intensity. Select a date to see time by motion level and open a timeline entry to see available pulse and forearm skin temperature. The Routines checklist records a completion for the local day.

Quiet entries group interruptions of up to 30 seconds and show the combined time without motion data. The routine checklists include timed phases, repetitions and rests. [NHS sitting exercises](https://www.nhs.uk/live-well/exercise/sitting-exercises/) · [NHS strength exercises](https://www.nhs.uk/live-well/exercise/strength-exercises/) · [CDC physical activity intensity](https://www.cdc.gov/physical-activity-basics/measuring/index.html)

## Run the dashboard

Use Node.js 24, Python 3.10 or later, and the local PostgreSQL and MQTT services. Start these commands from the checkout. On a laptop with Docker or Podman and Compose, use the backend's Compose file to start PostgreSQL and Mosquitto.

```bash
cd backend
[ -f .env ] || cp .env.example .env
docker compose up -d --wait postgres mosquitto
npm ci
npm run db:deploy
npm run db:seed
npm run build
npm start
```

Run `db:deploy` on an existing database before starting the updated backend. The seed creates demo accounts when the database is empty. In an existing database, use the ID of the patient who will wear the cuff. Set `PULSARS_HOST=127.0.0.1` and use a loopback `MQTT_URL` for the local wired demo.

In a second terminal, start the web app. `VITE_USER_ID=2` selects Alice Patient in a freshly seeded database.

```bash
cd frontend/Pulsars
[ -f .env ] || cp .env.example .env
npm ci
npm run build
API_PROXY_TARGET=http://127.0.0.1:3000 npm run preview -- --host 127.0.0.1 --port 4173
```

In PowerShell, use `Copy-Item .env.example .env` when creating a new configuration file. Assign `$env:API_PROXY_TARGET = 'http://127.0.0.1:3000'` on its own line before the preview command. Open [the local Fitness page](http://127.0.0.1:4173/fitness).

## Flash and connect the cuff

For a cuff already on firmware 0.2.3, start at the bridge step. For an upgrade, install the Espressif ESP32 board package and the ArduinoJson, OneWire, and DallasTemperature libraries using Arduino. From the checkout, compile with the wired profile and upload using the serial port reported by `arduino-cli board list`. The example port below is for Linux. On Windows it will be a COM port.

```bash
arduino-cli board list
arduino-cli compile --fqbn 'esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default,PartitionScheme=huge_app' --build-property 'compiler.cpp.extra_flags=-DPLAN_A_COMPETITION -DPLAN_A_USB_DEMO' --build-path device/.build/fitness-usb device/firmware/bracelet
arduino-cli upload --fqbn 'esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default,PartitionScheme=huge_app' --input-dir device/.build/fitness-usb --port /dev/ttyACM0 --verify device/firmware/bracelet
```

In another terminal, from the checkout, set up and start the USB bridge with the same patient ID as the dashboard.

```bash
cd device/bridge
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -u tools/receiver.py --usb --port auto --pulsars-user-id 2
```

On Windows PowerShell, use `py -m venv .venv` and `& '.\.venv\Scripts\python.exe'` for the two Python invocations. The bridge accepts an explicit serial port such as `COM3` or `/dev/ttyACM0` and a custom `--pulsars-mqtt-port`. Close other serial programs before opening the bridge. Leave it running while the cuff is connected.

Wear the cuff with the temperature probe seated against the inner forearm. After about ten seconds the first window can reach Fitness. Rest your fingertip on the optical sensor during quiet intervals to get usable pulse context. A missing or unsettled reading appears as unavailable. The motion bands describe measured forearm movement and can be checked with small rotations at the test bench. Use the date selector to see prior readings and the timestamp to check for recent data.

The bridge saves local NDJSON captures under `device/bridge/captures`. Its heartbeat enables the stream automatically. Firmware 0.2.2 supports the original 75-second vitals sessions. To return to that wired build, close the bridge and upload the saved 0.2.2 firmware using the same board profile.

## Data contract and verification

- A USB `get_status` heartbeat with `fitness: true` enables `fitness_window` on capable firmware. Each window contains the device and boot IDs, the starting uptime in milliseconds, and ten one-second slots. Slots or individual fields can be null. The fields are `motion_rms_g`, `gyro_rms_dps`, `pulse_bpm`, and `skin_temp_c`.
- The bridge publishes MQTT QoS 1 to `pulsars/<patientId>/fitness/window` with `v`, `deviceId`, `bootId`, `deviceTimeMs`, UTC `recordedAt`, and `samples`. It anchors the device uptime against the first complete window so USB timing jitter does not create gaps. The backend uses the identifiers and uptime to count retried windows once. Dashboard receives spot readings through `pulsars/<patientId>/vitals/+`.
- Read the monthly totals, selected-day timeline, and routine list at `GET /users/:id/fitness/calendar`, `/day`, and `/routines` under the same prefix. Supply an IANA `timeZone` query parameter, plus `month` or `date` for the first two. Complete a routine with `PUT /users/:id/fitness/routines/:key/completion` and a JSON body containing `timeZone`.
- Run `npm test` in the backend with its separate test database. Run `npm run build` and `npm run lint` in the frontend. From `device/bridge`, run `python -B -m unittest discover -s tests`. The firmware's host tests are under `device/tests`.
