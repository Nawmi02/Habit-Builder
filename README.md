# Habit Builder

Habit Builder is a habit-tracking app with an Expo mobile/web frontend and a Django REST API. It supports good and bad habits, scheduled count-based reminders, daily progress, streaks, points/XP, badges, and analytics including a consistency heatmap.

## Project layout

- `frontend-template/` — Expo app built with React Native, Expo Router, and TypeScript.
- `apps/` — Django apps for users, habits, tracking, and gamification.
- `config/` — Django settings, URLs, and Celery configuration.
- `docker-compose.yml` — local PostgreSQL, Redis, API, Celery worker, and Celery Beat services.
- `requirements.txt` — pinned Python dependencies for the backend.

## Requirements

### Recommended: Docker

- Docker Desktop with Docker Compose
- Node.js LTS and npm
- Expo Go on an Android phone, or an Android emulator

Docker supplies PostgreSQL and Redis, so they do not need to be installed separately.

### Without Docker

- Python 3.11 or newer
- PostgreSQL 16 (PostgreSQL is required; the project uses PostgreSQL `ArrayField`)
- Redis on `localhost:6379`, or a Redis-compatible service such as Memurai on Windows
- Node.js LTS and npm
- Expo Go on an Android phone, or an Android emulator

## Configure the backend

From the repository root, create the local environment file:

```powershell
Copy-Item .env.example .env
```

The example values are suitable for local development. The `.env` file contains secrets and is ignored by Git; do not commit it or share its contents.

## Run everything with Docker

1. Start Docker Desktop.
2. In a PowerShell terminal at the repository root, run:

   ```powershell
   docker compose up --build
   ```

   This starts PostgreSQL, Redis, Django, the Celery worker, and Celery Beat. The API container applies database migrations when it starts.

3. Open the API documentation at [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/).
4. In a second terminal, start the Expo app:

   ```powershell
   cd frontend-template
   Copy-Item env.example .env
   npm ci
   npx.cmd expo start --go --lan
   ```

5. Scan the QR code with Expo Go. Keep the phone and computer on the same Wi-Fi network.

To stop the stack, press `Ctrl+C` in the Docker terminal. To start only PostgreSQL and Redis in the background, use `docker compose up -d db redis`; then run the Django and Celery commands below from separate terminals.

## Run without Docker

### 1. Start PostgreSQL and Redis

Install and start PostgreSQL and Redis (or Memurai). The local `.env` should point to:

```dotenv
DATABASE_URL=postgres://habit:habit@localhost:5432/habit_builder
REDIS_URL=redis://localhost:6379/0
```

Create a PostgreSQL database named `habit_builder` and a user named `habit` with password `habit`, or change `DATABASE_URL` to match your local PostgreSQL credentials.

### 2. Install backend dependencies and migrate

From the repository root, create and activate a virtual environment:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
```

If PowerShell blocks activation scripts, skip activation and call the venv Python directly:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
```

### 3. Start Django and Celery

Open separate PowerShell terminals at the repository root and activate the virtual environment in each one. If PowerShell blocks activation, run commands through this interpreter path instead: .\.venv\Scripts\python.exe

**Terminal 1 — Django API:**

```powershell
python manage.py runserver 0.0.0.0:8000
```

**Terminal 2 — Celery worker:**

```powershell
python -m celery -A config worker -l info --pool=solo
```

**Terminal 3 — Celery Beat scheduler:**

```powershell
python -m celery -A config beat -l info
```

Check the API at [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/). The worker and Beat require Redis to be running.

## Set the frontend API address

The Expo app reads `EXPO_PUBLIC_API_URL` from `frontend-template/.env`. Include `/api` at the end of the URL.

| Where the app runs | Example value |
| --- | --- |
| Android emulator | `http://10.0.2.2:8000/api` |
| Expo Web on the same computer | `http://localhost:8000/api` |
| Physical phone on the same Wi-Fi | `http://YOUR_COMPUTER_LAN_IP:8000/api` |

For a phone, find the computer's Wi-Fi IPv4 address with `ipconfig` and use that address in `frontend-template/.env`, for example:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.0.105:8000/api
```

Add the same LAN IP to `ALLOWED_HOSTS` in the root `.env`, for example:

```dotenv
ALLOWED_HOSTS=127.0.0.1,localhost,10.0.2.2,192.168.0.105
```

Replace `192.168.0.105` with the computer's current Wi-Fi IPv4 address. The phone and computer must be on the same network. Allow Python/Django through Windows Firewall on private networks if the phone cannot connect. After changing the frontend `.env`, restart Expo with a cleared cache:

```powershell
npx.cmd expo start --go --lan --clear
```

## Dependencies

### Backend

- **Django 5.2** — backend web framework
- **Django REST Framework** and **Simple JWT** — API and token authentication
- **PostgreSQL** with `psycopg` — persistent application database
- **Celery**, **Redis**, and **django-celery-beat** — background reminder/occurrence jobs and scheduling
- **drf-spectacular** — OpenAPI schema and interactive API docs
- **django-cors-headers** and **django-environ** — browser API access and environment configuration

Install the pinned backend dependencies with `python -m pip install -r requirements.txt`.

### Frontend

- **Expo SDK 57**, **React Native 0.86**, and **React 19**
- **Expo Router** — file-based navigation
- **TypeScript** — typed app code
- **TanStack Query** — API data fetching and cache
- **Expo Notifications** and **Expo Secure Store** — notifications and local token storage

Install the exact npm dependency versions from `frontend-template/package-lock.json` with `npm ci`.

## App Interface

| Login or Sign up | Home dashboard |
| --- | --- |
| <img src="docs/screenshots/auth.jpeg" alt="Login and sign up screen" width="240"> | <img src="docs/screenshots/home.jpeg" alt="Home dashboard" width="240"> |
| Create Habit wizard | Habit list and details |
| <img src="docs/screenshots/create.jpeg" alt="Create Habit wizard" width="240"> | <img src="docs/screenshots/habits.jpeg" alt="Habit list and details" width="240"> |
| Start and complete habit flow | Analytics heatmap |
| <img src="docs/screenshots/habit%20start.jpeg" alt="Start and complete habit flow" width="240"> | <img src="docs/screenshots/analytics.jpeg" alt="Analytics heatmap" width="240"> |
| Progress, streaks, and badges | Reminder notification |
| <img src="docs/screenshots/badges.jpeg" alt="Progress, streaks, and badges" width="240"> | <img src="docs/screenshots/reminder.jpeg" alt="Reminder notification" width="240"> |

## Notifications note

Local reminders are scheduled by the app on the device. Server-side reminder delivery also depends on the Celery worker and Beat running, and a remote push sender must be configured before the backend can send push notifications. Remote push notifications are not available in Expo Go on Android; use an Expo development build for that flow.

## Useful commands

From the repository root:

```powershell
python manage.py showmigrations
python manage.py createsuperuser
```

From `frontend-template/`:

```powershell
npm run web
npm run android
npm run lint
```
