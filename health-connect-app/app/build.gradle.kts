plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.lifeos.healthbridge"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lifeos.healthbridge"
        /* Health Connect is only implemented from Android 8.0. Nothing below this
           has the platform to ask, so a lower minSdk would be a promise the app
           cannot keep. */
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            /* Deliberately unsigned-minimal. The point of this app is to read
               the user's own health data and push it to their own server, so
               there is nothing to obfuscate and a debug-signed release keeps
               the tutorial at "run one command" instead of "generate a
               keystore, then remember where you put it". */
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    /* ComponentActivity for registerForActivityResult. Not AppCompatActivity:
       the UI here is three buttons and a text view, and AppCompat would drag in
       a theme, a fragment dependency and a version to keep aligned for no gain. */
    implementation("androidx.activity:activity-ktx:1.9.3")
    /* lifecycleScope, so a sync that is still running when the user backs out
       is cancelled with the activity instead of leaking a coroutine. */
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    /* The whole reason this app exists. */
    implementation("androidx.health.connect:connect-client:1.1.0")

    /* org.json ships with Android, and HttpURLConnection ships with the JDK,
       so the sync path adds no networking dependency at all. A health payload
       is a flat tree of numbers; a serialization framework would be a way to
       spell the same JSON more slowly. */
}