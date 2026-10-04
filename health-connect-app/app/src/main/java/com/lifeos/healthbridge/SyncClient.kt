package com.lifeos.healthbridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * POSTs a payload to the LifeOS ingest endpoint.
 *
 * HttpURLConnection rather than OkHttp or Retrofit because there is exactly one
 * request shape in this app's entire life. A health payload is a flat tree of
 * numbers, sent once, with no headers that vary, no retries worth having, and no
 * interception to configure. Every dependency added here is a dependency that
 * can break the build on a machine the user set up once, for a job that
 * java.net already does.
 */
object SyncClient {

    data class Result(val status: Int, val body: String)

    suspend fun post(url: String, token: String, payload: Payload): Result =
        withContext(Dispatchers.IO) {
            val body = payload.toJson().toString().toByteArray(Charsets.UTF_8)

            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                /* Verified server-side by Supabase rather than decoded and
                   trusted. A wrong token is a 401 here, not someone else's data
                   on the server. */
                setRequestProperty("Authorization", "Bearer $token")
            }

            try {
                connection.outputStream.use { it.write(body) }

                val status = connection.responseCode
                val stream = if (status in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

                Result(status, text)
            } finally {
                connection.disconnect()
            }
        }
}