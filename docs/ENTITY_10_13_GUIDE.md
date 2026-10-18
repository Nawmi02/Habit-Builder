# Habit Builder – Entity 10–13 Backend Guide

ER entity 10–13 er backend: **POINT_TRANSACTION, BADGE, USER_BADGE, DEVICE_TOKEN**.
Teammate er entity 1–4 er project er upor-i banano, same style (ER naam, `db_table`, API te `x_id` naam).

---

## 1. Ki ki add/change hoyeche

### Notun file

| File | Ki |
|---|---|
| `Dockerfile` | Django + Celery chalanor image |
| `docker-compose.yml` | PostgreSQL 16, Redis 7, web (Django), worker, beat — ek command e shob |
| `.dockerignore` | Image e ja jabe na (venv, .git, .env) |
| `.env.example` | `.env` er template |
| `apps/gamification/` | **Entity 10, 11, 12** – models, migrations, services, signals, serializers, views, urls, admin, tests |
| `apps/tracking/` | **Entity 5 er choto starter** (shudhu `occurrence`, `progress_value`, `completed_at`). Entity 10 er FK er jonno lagbe. Entity 5 er teammate ekhanei baki field add korbe |
| `apps/users/services.py` | **Entity 13** helper: `get_push_tokens()`, `remove_push_token()`, `touch_device()` |
| `docs/ENTITY_10_13_GUIDE.md` | Ei guide |

### Teammate er file e change (shudhu 6 ta)

| File | Change | Keno |
|---|---|---|
| `config/settings.py` | `apps.tracking`, `apps.gamification` add; `GAMIFICATION` rules; `USER_REWARD_MODEL`, `STREAK_MODEL` | Notun app chalu, point er niyom ek jaygay |
| `config/urls.py` | `api/` e gamification urls | `/api/points/`, `/api/badges/` |
| `apps/users/serializers.py` | `push_token` hate declare; `DeviceTokenUnregisterSerializer` | **Bug fix:** ager same phone token abar pathale 400 error dito |
| `apps/users/views.py` | `DeviceTokenView` → `DeviceTokenViewSet` (list, create, delete, unregister) | Entity 13 er puro API |
| `apps/users/urls.py` | `devices/` router e | Notun viewset er URL |
| `apps/users/tests.py` | Device token test | |

**Entity 13 keno `users` app e?** Teammate already `DeviceToken` model `users` app e baniye migration korechilo. Shoralei migration bhangto, tai model oikhane rekhe API ar helper complete korechi.

---

## 2. Setup (VS Code + Docker)

### Lagbe
- **Docker Desktop** (Windows/Mac) – install kore chalu rakho
- **VS Code** + Python extension
- **Python 3.12** (Docker chara chalate chaile)

### Step 1: Project kholo
```bash
cd Habit-Builder
code .
```

### Step 2: `.env` banao
```powershell
# Windows PowerShell
Copy-Item .env.example .env
```
```bash
# Mac / Linux
cp .env.example .env
```

### Option A: Shob Docker e (sobcheye shohoj)
```bash
docker compose up --build
```
- API: http://localhost:8000/api/docs/ (Swagger)
- Admin: http://localhost:8000/admin/

Arek terminal e:
```bash
docker compose exec web python manage.py createsuperuser
docker compose exec web python manage.py test apps.gamification apps.users
```

### Option B: Database Docker e, Django VS Code e (debug korar jonno bhalo)
```bash
docker compose up -d db redis          # shudhu PostgreSQL + Redis

python -m venv venv
venv\Scripts\activate                  # Windows
# source venv/bin/activate             # Mac / Linux
pip install -r requirements.txt

python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```
VS Code e: `Ctrl+Shift+P` → **Python: Select Interpreter** → `venv` select koro.

### Check
```bash
python manage.py makemigrations --check --dry-run   # "No changes detected" ashbe
python manage.py test apps.gamification apps.users  # shob test pass
```
`makemigrations --check` jodi kono change dekhay, shudhu `python manage.py makemigrations` chalao, notun migration toiri hobe.

### Common problem

| Problem | Fix |
|---|---|
| `port 5432 is already allocated` | PC te age theke PostgreSQL chalche. Oita bondho koro, ba `docker-compose.yml` e `"5433:5432"` kore `.env` e port 5433 dao |
| `could not connect to server` | `docker compose up -d db` chalu ache kina dekho (`docker compose ps`) |
| `relation "users" does not exist` | `python manage.py migrate` chalao |
| SQLite error `ArrayField` | `.env` e `DATABASE_URL` PostgreSQL er dao, SQLite e cholbe na |

---

## 3. API (shob endpoint e login lage: `Authorization: Bearer <access token>`)

Token pete: `POST /api/auth/login/` body `{"email": "...", "password": "..."}` → `access` copy koro → Swagger e **Authorize** e `Bearer <token>` dao.

### POINT_TRANSACTION (entity 10)

| Method | URL | Kaj |
|---|---|---|
| GET | `/api/points/` | Amar point history (notun age), page e 50 ta |
| GET | `/api/points/?related_type=STREAK` | Type diye filter (COMPLETION, DAILY_BONUS, STREAK, BADGE) |
| GET | `/api/points/{point_id}/` | Ekta transaction |
| GET | `/api/points/summary/` | Total point, level, next level, checkins, badge count |

```json
GET /api/points/summary/
{
  "total_points": 230,
  "level": 3,
  "next_level_at": 300,
  "points_to_next_level": 70,
  "checkins": 15,
  "badges_unlocked": 2
}
```
```json
GET /api/points/
{
  "count": 2, "next": null, "previous": null,
  "results": [
    {"point_id": 8, "user_id": 1, "completion_id": null, "related_type": "DAILY_BONUS",
     "points": 20, "reason": "All habits completed on 2026-10-18", "created_at": "2026-10-18T07:10:00Z"},
    {"point_id": 7, "user_id": 1, "completion_id": 41, "related_type": "COMPLETION",
     "points": 10, "reason": "Completed Read", "created_at": "2026-10-18T07:09:58Z"}
  ]
}
```
Point **API diye banano jay na** (POST nai). Point shudhu niyom mene system dey, jate keu nijer point bariye nite na pare.

### BADGE + USER_BADGE (entity 11, 12)

| Method | URL | Kaj |
|---|---|---|
| GET | `/api/badges/` | Shob badge + amar `unlocked`, `unlocked_at`, `progress` |
| GET | `/api/badges/{badge_id}/` | Ekta badge |
| GET | `/api/badges/mine/` | Shudhu amar unlock kora badge |

```json
GET /api/badges/
[
  {"badge_id": 1, "code": "first-checkin", "name": "First Step", "description": "Complete your first habit.",
   "condition_type": "TOTAL_CHECKINS", "condition_value": 1,
   "unlocked": true, "unlocked_at": "2026-10-18T07:09:58Z", "progress": 1},
  {"badge_id": 4, "code": "checkins-100", "name": "First 100 Check-ins", "description": "Complete habits 100 times in total.",
   "condition_type": "TOTAL_CHECKINS", "condition_value": 100,
   "unlocked": false, "unlocked_at": null, "progress": 15}
]
```
`progress` diye app e "15 / 100" progress bar dekhano jay. Notun badge add korte: Django admin → Badges → Add.

### DEVICE_TOKEN (entity 13)

| Method | URL | Body | Kaj |
|---|---|---|---|
| GET | `/api/devices/` | – | Amar phone gula |
| POST | `/api/devices/` | `{"push_token": "fK3x...", "platform": "ANDROID"}` | Notun hole 201, age thakle 200 (update) |
| DELETE | `/api/devices/{device_id}/` | – | Ekta device muche fela |
| POST | `/api/devices/unregister/` | `{"push_token": "fK3x..."}` | Logout er shomoy token muche fela (204) |

---

## 4. Point kivabe ashe (niyom)

| Ghotona | Point | `related_type` | `completion_id` |
|---|---|---|---|
| Ekta habit complete | +10 | COMPLETION | ache |
| Aj er shob daily/weekday habit done (skip cholbe) | +20 | DAILY_BONUS | NULL |
| Kono habit e 7 din streak | +50 | STREAK | NULL |
| Kono habit e 30 din streak | +150 | STREAK | NULL |
| Badge unlock | 0 (badge-i reward) | BADGE | NULL |
| Level | protiti 100 point e +1 level | – | – |

Shob number `config/settings.py` er `GAMIFICATION` e. Bodlate code chhute hobe na.

**Flow (habit done):**
```
Entity-5 code: occurrence.status = COMPLETED, CompletionRecord save (completed_at shoho)
      │
      ▼  (signal, automatic)
on_habit_completed()
  1. +10 COMPLETION point (ekbar-i, completion_id UNIQUE)
  2. aj er shob habit done? → +20 DAILY_BONUS (ekbar-i)
  3. check_badges() → notun badge unlock
  4. USER_REWARD update (entity 9 thakle)
```
**Undo (FR-08):** CompletionRecord delete ba `completed_at = None` korle oi point ar oi diner daily bonus chole jay. Badge thake (ekbar pele ar jay na).

---

## 5. Teammate der jonno (integration)

| Teammate | Ki korte hobe |
|---|---|
| **Entity 5 (COMPLETION_RECORD)** | `apps/tracking/models.py` e baki field (source, note, mood, skip_reason, synced_at) add koro, `makemigrations tracking` (0002 hobe). App label `tracking` ar model naam `CompletionRecord` **bodlabe na**. Habit done hole age `occurrence.status = COMPLETED` save, tarpor `CompletionRecord` e `completed_at` set. Point automatic. |
| **Entity 7 (STREAK)** | Streak update er por: `from apps.gamification.services import on_streak_updated` → `on_streak_updated(habit, streak.current_streak, today)`. `.env` e `STREAK_MODEL=<app>.Streak` |
| **Entity 8 (REMINDER / push)** | Token pete: `from apps.users.services import get_push_tokens` → `get_push_tokens(user)`. FCM "UNREGISTERED" bolle: `remove_push_token(token)`. Badge notification: `on_habit_completed()` / `on_streak_updated()` er result e `new_badges` |
| **Entity 9 (USER_REWARD)** | Model e `user` (OneToOne), `total_points`, `level` field rakho. `.env` e `USER_REWARD_MODEL=<app>.UserReward`. Ami nije update kore dibo |

---

## 6. File by file explanation

### 6.1 `apps/gamification/models.py`

| Line / block | Ki store kore / ki kore |
|---|---|
| Docstring (1–10) | Kon ER entity, ar entity 13 kothay ache |
| Imports (12–15) | `settings` (User model er naam), `MinValueValidator`, `models`, `Q` (constraint er condition) |
| `class Badge` | **Entity 11.** Badge er list |
| `ConditionType` | Badge kon jinish gune unlock hobe: `TOTAL_CHECKINS` (koyta habit done), `STREAK_DAYS` (streak din), `TOTAL_POINTS` |
| `code = SlugField(unique=True)` | ER er UK. Jemon `"streak-7"`. Code e badge chinte, naam bodlaleo code same thake |
| `name`, `description` | App e dekhanor lekha |
| `condition_type`, `condition_value` | Jemon `STREAK_DAYS` + `7` = 7 din streak e unlock. `MinValueValidator(1)` → 0 deya jabe na |
| `Meta: db_table="badge"` | Table er naam ER er moto |
| `ordering` | List e type, tarpor value onujayi shajano |
| `class UserBadge` | **Entity 12.** Kon user kon badge peyeche (M:N bridge) |
| `user`, `badge` FK, `CASCADE` | User ba badge delete hole eta-o muche jay (NFR-11 account delete) |
| `related_name="user_badges"` | `user.user_badges.all()` diye user er badge |
| `unlocked_at = auto_now_add` | Unlock er shomoy nije bosbe |
| `UniqueConstraint(user, badge)` | Ek badge ekjon ekbar-i pabe. Database nije atkay |
| `class PointTransaction` | **Entity 10.** Protita point er history |
| `RelatedType` | Point kon karone: COMPLETION, DAILY_BONUS, STREAK, BADGE |
| `user` FK | Kar point |
| `completion = OneToOneField(..., null=True)` | ER er `completion_id`. **OneToOne** mane ek completion e ekta-i point row (rule 11.7). **null=True** karon bonus er completion nai. `"tracking.CompletionRecord"` string, tai onno app import lage na |
| `on_delete=CASCADE` | Completion delete (undo) hole point o delete |
| `related_type`, `points`, `reason`, `created_at` | ER er field |
| `ordering = ["-created_at", "-id"]` | Notun point age |
| `Index(user, created_at)` | "Amar point history" query fast (NFR-02) |
| `UniqueConstraint(user, reason, condition=~Q(COMPLETION))` | Bonus (daily, streak, badge) er same reason duibar na. Jemon "All habits completed on 2026-10-18" ekbar-i. COMPLETION row baad, karon "Completed Read" protidin hote pare |
| `CheckConstraint(...)` | COMPLETION type hole `completion_id` thaktei hobe. Bhul data database dhuktei dibe na |

### 6.2 `apps/gamification/migrations/`

| File | Kaj |
|---|---|
| `0001_initial.py` | 3 ta table, index, constraint banay. `tracking 0001` er pore chole (FK er jonno) |
| `0002_seed_badges.py` | 4 ta badge add: First Step (1 checkin), 7-Day Streak, 30-Day Streak, First 100 Check-ins. `update_or_create` → abar chalaleo duplicate hoy na. Rollback e muche dey |

### 6.3 `apps/gamification/services.py` (sob niyom ekhane)

| Function | Ki kore | Example |
|---|---|---|
| `_DEFAULTS`, `cfg(key)` | Point er default niyom; `settings.GAMIFICATION` e thakle oita ney | `cfg("COMPLETION_POINTS")` → 10 |
| `total_points(user)` | Shob transaction er `SUM(points)` | 230 |
| `checkin_count(user)` | COMPLETION row koyta = koyta habit done | 15 |
| `level_for(points)` | `points // 100 + 1`. Negative hole 0 dhore | 99→1, 100→2, 250→3 |
| `progress_summary(user)` | `/api/points/summary/` er data | upore JSON |
| `_get_model(setting)` | Settings e naam thakle (jemon `"streaks.Streak"`) model ta khuje dey, na thakle `None`. Tai onno teammate er model na thakleo crash kore na | |
| `_sync_user_reward(user)` | Entity 9 thakle oi table e total_points ar level boshay | |
| `best_current_streak(user)` | Entity 7 thakle user er sobcheye boro current streak | |
| `badge_progress_values(user)` | Protiti condition type er ekhon value | `{"TOTAL_CHECKINS": 15, "TOTAL_POINTS": 230, "STREAK_DAYS": 7}` |
| `_daily_bonus_reason(day)` | Daily bonus er fixed reason, jate ek din e ekbar | `"All habits completed on 2026-10-18"` |
| `_give_bonus(...)` | Bonus row banay; `IntegrityError` (age deya) hole chupchap `None`. `atomic()` er bhitore, jate error baki kaj nosto na kore | |
| `award_daily_bonus_if_earned(user, day, just_completed_id)` | Oi diner shob DAILY/WEEKDAYS habit COMPLETED ba SKIPPED hole +20. Ekhon je ta complete holo sheta "done" dhore (status pore save holeo) | Read done, Water skip → bonus |
| `check_badges(user, current_streak)` | Na-paoa badge gulo check kore, condition mile gele `UserBadge` banay. Notun badge er list ferot dey | |
| `on_habit_completed(completion)` | Main hook: +10, daily bonus (shudhu daily/weekday habit e), badge, USER_REWARD. Duibar dakleo ekbar-i point | |
| `on_completion_undone(occurrence)` | Oi occurrence er point ar oi diner daily bonus muche dey | |
| `on_streak_updated(habit, streak, day)` | 7/30 din hole milestone bonus + streak badge. Entity 7 teammate dakbe | |
| `@transaction.atomic` | Pura kaj ek sathe: majhe error hole kichui save hoy na | |

### 6.4 `apps/gamification/signals.py`

| Block | Ki kore |
|---|---|
| `COMPLETION_MODEL = "tracking.CompletionRecord"` | String diye model dhora, import chara |
| `completion_saved` (post_save) | `completed_at` thakle → `on_habit_completed`; `None` hole → `on_completion_undone` |
| `completion_deleted` (post_delete) | Completion delete hole oi diner daily bonus o muche dey (nijer point CASCADE e already gechhe) |
| `apps.py` er `ready()` | App chalu holei signal connect |

**Analogy:** signal holo dorjar ghonta. Entity 5 er code shudhu completion save kore (ghonta bajay), point er kaj nije-i hoye jay.

### 6.5 `apps/gamification/serializers.py`

| Class | Kaj |
|---|---|
| `PointTransactionSerializer` | Model → JSON; `id` ke `point_id`, FK ke `user_id`, `completion_id` naame dey (ER er naam). Shob read-only |
| `BadgeSerializer` | Badge + 3 ta extra: `unlocked` (pai kina), `unlocked_at`, `progress` (goal porjonto, unlock hole full). Data ashe view er `context` theke, tai protiti badge e alada query hoy na |
| `UserBadgeSerializer` | Amar badge: badge er code, naam, description shoho |

### 6.6 `apps/gamification/views.py` + `urls.py`

| Part | Kaj |
|---|---|
| `PointTransactionViewSet` (ReadOnly) | List + detail; `get_queryset` shudhu `request.user` er row (NFR-10), tai onner `point_id` dile 404 |
| `swagger_fake_view` check | Swagger page banate giye login chara crash na kore |
| `related_type` filter | `?related_type=streak` → upper case kore filter |
| `summary` action | `/api/points/summary/` |
| `BadgeViewSet` (ReadOnly) | Badge list/detail. POST/PUT/DELETE nai (405). `pagination_class=None` karon badge kom |
| `get_serializer_context` | Ekbar e user er owned badge ar progress value ber kore serializer ke dey |
| `mine` action | `/api/badges/mine/` |
| `urls.py` | `SimpleRouter` (`DefaultRouter` er moto duplicate API root banay na) |

### 6.7 `apps/gamification/admin.py`

Badge, UserBadge, PointTransaction admin e: list column, filter, search. Notun badge admin theke add.

### 6.8 Entity 13 – `apps/users/` er change

| Part | Kaj |
|---|---|
| `DeviceTokenSerializer.push_token = CharField(...)` | **Bug fix.** ModelSerializer `unique=True` field e nije `UniqueValidator` boshay, tai same token abar pathale view e pouchanor agei 400 dito. Hate declare kore validator bad |
| `DeviceTokenUnregisterSerializer` | Shudhu `push_token` nay |
| `DeviceTokenViewSet` | `List` + `Destroy` mixin + custom `create` + `unregister` |
| `create` → `update_or_create(push_token=...)` | Token notun hole row (201), age thakle update (200). Onno account e login korle token notun user e chole jay |
| `unregister` | Logout e token diye muche fela; shudhu nijer token |
| `get_queryset` | Shudhu nijer device; onner `device_id` delete korte gele 404 |
| `services.get_push_tokens(user)` | User er token list; notification off hole `[]` (NFR-15) |
| `services.remove_push_token(token)` | FCM dead token bolle muche fela |
| `services.touch_device(token)` | `last_active` ekhon kore (`update()` e `auto_now` chole na, tai hate) |

### 6.9 `apps/tracking/` (entity 5 starter)

`CompletionRecord` e shudhu `occurrence` (OneToOne, ek occurrence e ekta completion), `progress_value`, `completed_at`. Entity 10 er FK er jonno minimum. Entity 5 teammate eta extend korbe.

### 6.10 Docker files

| File / part | Kaj |
|---|---|
| `Dockerfile` `FROM python:3.12-slim` | Chhoto Python image |
| `COPY requirements.txt` → `pip install` → `COPY . .` | Requirements age copy, tai code change e abar install lage na (cache) |
| `docker-compose.yml` `db` | PostgreSQL 16, user/password/db `habit`, data `pgdata` volume e thake, `healthcheck` diye ready kina dekhe |
| `redis` | Celery er queue |
| `x-backend` anchor | web, worker, beat er common setting ek jaygay |
| `web` | Age `migrate`, tarpor server `:8000` |
| `worker`, `beat` | Celery task (teammate er hourly occurrence task) |
| `volumes: .:/app` | Code edit korlei container e update |

### 6.11 Tests (`apps/gamification/tests.py`, `apps/users/tests.py`)

| Test group | Ki check kore |
|---|---|
| `PointRulesTests` | +10 ekbar-i, daily bonus shudhu shob done hole, skip e bonus atke na, weekly habit e daily bonus na, undo te point o bonus chole jay, progress e point na, streak 7 e +50 ekbar, level formula, settings theke niyom |
| `BadgeTests` | Seed badge ache, first-checkin unlock, streak badge ekbar-i |
| `DatabaseConstraintTests` | COMPLETION chara completion error, same bonus duibar error, same badge duibar error |
| `GamificationApiTests` | Shudhu nijer point, filter, summary, onner point 404, badge progress, mine, badge POST 405, login chara 401 |
| `DeviceTokenApiTests` | Register 201, abar 200, onno account e move, bhul platform 400, nijer list, delete, onnerta 404, unregister, notification off hole token na |

---

## 7. Teammate er code e ja dekhlam (ora fix korbe)

| Kothay | Problem | Fix |
|---|---|---|
| `habits/services.py` TIMES_PER_WEEK | "3 times a week" e 3 ta row banate chay, kintu `UniqueConstraint(habit, scheduled_date)` er karone 1 ta-i toiri hoy (`ignore_conflicts` baki gula chupchap bad dey) | `HabitOccurrence` e `slot` field add kore unique `(habit, scheduled_date, slot)` |
| `habits/views.py` `pause` / `resume` | `timezone.now().date()` UTC date, user er date na (NFR-07) | `_user_today(request.user)` use |
| `habits/services.py` `_user_today` | `timezone.pytz` line Django 5 e nai, kaj kore na (crash kore na) | Line ta muche dao |
| `checklist` percent | Skip ke-o total e dhore (FR-09 bole skip % e na) | `total - skipped` diye bhag |
| `config/settings.py` | `BLACKLIST_AFTER_ROTATION=True`, kintu `rest_framework_simplejwt.token_blacklist` INSTALLED_APPS e nai, tai logout/blacklist kaj korbe na | App add + `migrate` |
| `HabitSerializer` | `schedule` optional, schedule chara habit e occurrence-i hoy na | Create e `schedule` required |

---

## 8. Git e push

```bash
git checkout -b feature/entity-10-13
git add .
git commit -m "feat(gamification): add point transactions, badges, user badges and device token API"
git push origin feature/entity-10-13
```
Tarpor GitHub e Pull Request kholo, teammate review kore merge korbe.
