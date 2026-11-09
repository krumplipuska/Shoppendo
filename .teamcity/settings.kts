import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.vcs

/*
 * Shoppendo Android builds (TeamCity 2026.2, versioned settings).
 *
 *   Android dev   test ads, com.tamasbagyinszki.shoppendo.dev   runs on every push
 *   Android prod  real ads, com.tamasbagyinszki.shoppendo       run by hand, upload the .aab to Play
 *   Android pro   no ads,   com.tamasbagyinszki.shoppendo.pro   run by hand, upload the .aab to Play
 *
 * Each build runs the tests, then `scripts/build-android.mjs both <variant>`, which makes a signed .aab and
 * .apk plus R8's mapping file, published as artifacts. Builds run on the Mac agent: it has the Android SDK
 * and reads the Play upload key from android.credentialsDir, so the key never goes into git or TeamCity.
 * Each build's version code is its build counter + android.versionCodeOffset (Play accepts each code once
 * per app; locally built bundles used codes below 100).
 */

version = "2026.2"

project {
    description = "Android builds: dev (test ads), prod (real ads), pro (paid, no ads)"

    params {
        param("android.credentialsDir", "/Users/tamasbagyinszki/Downloads/Shoppendo/credentials")
        param("android.versionCodeOffset", "100")
    }

    buildType(AndroidDev)
    buildType(AndroidProd)
    buildType(AndroidPro)
    buildTypesOrder = listOf(AndroidDev, AndroidProd, AndroidPro)
}

open class AndroidBuild(variant: String, title: String, summary: String, onPush: Boolean) : BuildType({
    id("Android_" + variant.replaceFirstChar { it.uppercase() })
    name = title
    description = summary
    artifactRules = "dist/android/$variant/** => ."
    buildNumberPattern = "%build.counter%"

    vcs {
        root(DslContext.settingsRoot)
        cleanCheckout = false
    }

    params {
        param("env.ANDROID_CREDENTIALS_DIR", "%android.credentialsDir%")
    }

    steps {
        script {
            name = "Install and test"
            scriptContent = """
                set -euo pipefail
                npm ci
                npm test
            """.trimIndent()
        }
        script {
            name = "Build signed $variant bundle and APK"
            scriptContent = """
                set -euo pipefail
                rm -rf dist/android
                export ANDROID_VERSION_CODE=$(( %build.counter% + %android.versionCodeOffset% ))
                node scripts/build-android.mjs both $variant
            """.trimIndent()
        }
    }

    if (onPush) {
        triggers {
            vcs { }
        }
    }

    requirements {
        contains("teamcity.agent.jvm.os.name", "Mac")
    }

    failureConditions {
        executionTimeoutMin = 60
    }
})

object AndroidDev : AndroidBuild("dev", "Android dev", "Test ads; Shoppendo Dev installs next to the store apps.", onPush = true)
object AndroidProd : AndroidBuild("prod", "Android prod (ads)", "Free Play Store app with real AdMob ads.", onPush = false)
object AndroidPro : AndroidBuild("pro", "Android pro (paid, no ads)", "Paid Play Store app without ads or the ads SDK.", onPush = false)
