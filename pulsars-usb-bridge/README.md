# Pulsars USB bridge on Linux

Use this bundle alongside the team member's existing Pulsars checkout. The cuff is already flashed with wired firmware 0.2.2. It sends serial JSON over USB‑C. The bridge saves a local capture and sends valid readings to the Pulsars MQTT subscriber.

## One-time setup

You need Node.js 24 with npm, Docker with the Compose plugin, and Python 3 with venv. Download dependencies and container images before the pitch.

### Terminal 1 · Pulsars backend

Open a terminal in the root of the existing Pulsars checkout. Use the branch with the backend and live dashboard.

```bash
git fetch origin
git switch backend-dev
cd backend
test -f .env || cp .env.example .env
MQTT_PORT=127.0.0.1:1883 POSTGRES_PORT=127.0.0.1:5433 docker compose up -d --wait postgres mosquitto
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Look for `[mqtt] subscribed to pulsars/+/vitals/+`. The branch uses localhost ports 1883 for Mosquitto, 5433 for Postgres and 3000 for the API. Check `backend/.env` if that file already existed. [Pulsars backend-dev](https://github.com/turtlevlz/Pulsars/tree/backend-dev) · [Docker Compose startup](https://docs.docker.com/reference/cli/docker/compose/up)

### Terminal 2 · Dashboard

Open a new terminal in the Pulsars checkout root.

```bash
cd frontend/Pulsars
test -f .env || cp .env.example .env
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL Vite prints and sign in. On a fresh seed the demo patient is `alice@pulsars.local` / `password123`, which is user ID 2. The dashboard shows whoever is signed in, so give the bridge that patient's ID (`--pulsars-user-id`); the bridge itself publishes over the (anonymous, loopback-only) MQTT broker and does not sign in.

### Terminal 3 · USB bridge

Unpack the ZIP and open a terminal in its `pulsars-usb-bridge` folder.

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python -u tools/receiver.py --usb --port auto --pulsars-user-id 2
```

If your system reports that venv or ensurepip is missing, install your distribution's Python venv package and retry. If the receiver reports permission denied, check the actual serial port and its owning group. On Debian or Ubuntu where the port belongs to `dialout`, add your account with `sudo usermod -aG dialout "$USER"` and log out and back in once.

## Rehearse and present

Leave all three terminals running. The bridge should report `Pulsars MQTT connected`. Plug the cuff into the Linux laptop with a USB data cable. Wait for `Opened USB port`, then place a fingertip on the optical sensor and keep it still. Data starts reaching the dashboard after signal acquisition and 15 seconds of stabilization. Pulsars polls every five seconds. Leave the finger in place until the session completes at 75 seconds from its start.

Pulse and experimental fingertip SpO₂ are sent by default. The capture under `captures/` also includes skin temperature, motion, and quality. Add `--pulsars-skin-temp` after the dashboard agent has relabelled the temperature channel as forearm skin temperature and removed core-temperature interpretation.

Use one receiver per cuff. If more than one Espressif device is connected, run `./.venv/bin/python -m serial.tools.list_ports -v` and replace `--port auto` with the cuff's actual path, for example `--port /dev/ttyACM0`. Leave the Pulsars simulator stopped during the live demo.
