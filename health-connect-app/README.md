# LifeOS Health Bridge

A small Android app that reads Samsung Health (via Health Connect) and pushes it
to your LifeOS server, replacing the synthetic vitality data the web app used to
show.

The browser cannot do this. Health Connect is a system service with a native
permission model, so something on the phone has to ask it for the data. That
something is this app. It has no accounts, no database, and no UI beyond three
buttons — it reads, it POSTs, it logs what happened.

## How the data flows

```
Samsung Health ──writes──▶ Health Connect ──read by──▶ this app ──POST──▶ /api/health/ingest
                                                                       │
                                                                       ▼
                                                                  health_daily
                                                                health_sessions
                                                                       │
                                                                       ▼
                                                          SyncProvider (server)
                                                                       │
                                                                       ▼
                                                                /vitals and friends
```

The app re-reads the whole window on every sync and recomputes each night from
scratch. Nothing is incremental, so a sync that fails halfway and is retried
leaves the same result as one that succeeded first time.

## What it sends

**Daily rows**, one per (day, writing app). Not one per day, on purpose — the
phone's own pedometer, Google Fit and Samsung Health all write to Health Connect
and they disagree, so the phone emits each one separately and the server picks,
preferring Samsung Health. Summing them would count one walk twice.

| Field | Source |
|---|---|
| `steps` | `StepsRecord` |
| `activeMin` | `ActiveMinutesBurnedRecord` |
| `activeKcal` | `ActiveCaloriesBurnedRecord` |
| `restingHr` | `RestingHeartRateRecord` (mean of the day) |
| `hrvRmssd` | `HeartRateVariabilityRmssdRecord` (mean; RMSSD in ms, not SDNN) |
| `spo2` | `OxygenSaturationRecord` (mean) |
| `respiratoryRate` | `RespiratoryRateRecord` (mean) |
| `sleep*Min`, `sleep*Utc` | `SleepSessionRecord`, rolled up per night |

**Sessions**, one per workout, keyed by Health Connect's own record id.

Two things about sessions are worth knowing before you trust the numbers:

- **Sleep is filed under the morning it ends.** A night's stages straddle
  midnight; assigning stages to their own local date would put most of a night
  under the wrong day. So "last night's sleep" means what you think it means.
- **Per-session calories, distance and heart rate are derived from records
  inside the workout window**, because `ExerciseSessionRecord` does not carry
  them — its `segments` and `laps` are timing only. Heart rate comes from a
  Health Connect aggregate over the window, which the platform computes
  on-device, so the app never pulls the raw samples. A calorie or distance
  record that merely overlaps a workout is counted against it, which is a small
  and bounded error. `durationMin` is the elapsed span.

## Prerequisites

- Android Studio (Ladybug or newer)
- JDK 17 — Android Studio bundles one; use it
- A phone on Android 8.0 or newer
- Samsung Health installed and signed in, if you want Samsung data specifically
- Your LifeOS site deployed, so the phone has something to POST to

## Before you build: the server needs its migration

The ingest endpoint writes five columns that predate this app. Apply them first,
or every sync fails on an unknown column:

```bash
npx drizzle-kit migrate
```

This applies `drizzle/0009_health_sleep_window.sql`, which adds
`sleep_start_utc`, `sleep_end_utc` and `active_kcal` to `health_daily`, and
`avg_hr` and `max_hr` to `health_sessions`. Without it every sync fails on an
unknown column.

## Get an access token

The app authenticates with a **Supabase access token**, not the web session
cookie. It sends it as `Authorization: Bearer <token>` and the server verifies it
against Supabase (`getUser`), the same way it verifies the cookie.

The simplest source is Supabase Dashboard → your project → **Authentication →
Sessions**, and copy the `access_token` from your active browser session. It is a
JWT with an `exp` claim.

Access tokens last about an hour. When a sync returns **401**, paste a fresh
one. This app deliberately does not implement refresh: adding a token endpoint
and a refresh loop to a personal sideloaded build is more surface than the
problem warrants, and a stale token failing loudly is better than a silent
background refresh nobody audits.

## Build the APK

From this directory:

```bash
cd health-connect-app

# Debug build — the one to install while you are setting this up
./gradlew assembleDebug
```

The APK lands at:

```
app/build/outputs/apk/debug/app-debug.apk
```

For something you can sideload and keep:

```bash
./gradlew assembleRelease
app/build/outputs/apk/release/app-release.apk
```

The release build is **signed with the debug key** on purpose. This app is a
personal bridge with no distribution channel, and making you generate a
keystore before you can see whether your sleep data arrives would be the wrong
first impression. Swap in a real signing config when this is something you ship.

On Windows, `gradlew.bat` is the entry point. If Gradle cannot find a JDK,
point it at Android Studio's:

```bash
# macOS/Linux
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# Windows PowerShell
$env:JAVA_HOME = "C:\Program Files\Android Studio\jbr"
```

## Install

**Easiest:** plug the phone in with USB debugging on and run:

```bash
./gradlew installDebug
```

**Or** copy the APK to the phone and open it. You will need "install from
unknown sources" for whatever app you opened it with. Enable it in
Settings → Apps → Special access → Install unknown apps.

## First run

1. Open **LifeOS Health Bridge**.
2. **Grant health permissions.** The system shows a list of every health type
   the app asked for, each attributed to the app that wrote it — so you should
   see Samsung Health named for most of them. Grant what you want; partial
   permission is fine and the sync still works, it just sends nulls for the rest.
3. **Paste the server URL** — the site root, not the full path:
   `https://your-app.vercel.app`. The app appends `/api/health/ingest` itself.
4. **Paste the access token.**
5. **Set days to read.** 14 is the default and enough to establish a readiness
   baseline. Start smaller (3) while testing so a failure is easy to read.
6. **Sync now.** The log pane prints what it read, what it sent, and what the
   server replied.

The web app keeps using mock data until it has at least two complete days of
real sleep, resting HR and HRV. That is deliberate — readiness is meaningless
without a baseline — so a correct first sync will not immediately change
`/vitals`, and a sync that runs on days with incomplete sleep will keep it on
mock data forever.

## If a sync sends nothing

`Nothing in Health Connect for the last N days` almost always means Samsung
Health is not writing to Health Connect. In Samsung Health:

- **Settings → Data sync and background refresh** — make sure sync is on.
- **Settings → Health Connect** — make sure it is enabled for Samsung Health.
- Walk/run for a couple of minutes and sync again. Samsung Health batches;
  it does not push every reading the moment it takes it.

## Security note

The access token is stored in `SharedPreferences` as plain text. For a personal
sideloaded build holding a token that can only read and write your own health
rows, that is a reasonable trade. If you ever distribute this, move it to
`EncryptedSharedPreferences` before it ships.

## Status: not yet compiled

This app was written against the Health Connect 1.1.0 API but has never been
built — there was no Android toolchain available when it was written. Expect to
fix a small number of signature mismatches on first compile. The fields most
worth checking, in order of likelihood:

- `ActiveMinutesBurnedRecord.activeDuration` — older versions exposed
  `minutes: Double` instead.
- `RespiratoryRateRecord.respiratoryRate` — confirm the unit is breaths/min.
- `OxygenSaturationRecord.percentage.value` — confirm it is a `Double` percentage.
- `HealthPermission.getReadPermission(...)` overloads and
  `PermissionController.createRequestPermissionResultContract()`.
- AGP 8.5.2 / Kotlin 2.0.21 — bump if your Android Studio is newer and the two
  disagree.

Everything the reader treats as a *missing value* degrades to null and a warning
in the log pane rather than crashing, so a wrong field name costs one metric
rather than the sync.