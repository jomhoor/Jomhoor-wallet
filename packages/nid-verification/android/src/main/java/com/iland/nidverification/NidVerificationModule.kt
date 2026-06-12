package com.iland.nidverification

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.IsoDep
import android.nfc.tech.Ndef
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NidVerificationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val stateLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val probeExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  private var pendingPromise: Promise? = null
  private var pendingActivity: Activity? = null
  private var pendingAdapter: NfcAdapter? = null
  private var pendingSessionId: String? = null
  private var pendingStartedAtMs: Long = 0
  private var pendingTimeout: Runnable? = null
  private var activeIsoDep: IsoDep? = null
  private var tagHandled = false
  private var phaseTransitionScheduled = false
  private var currentStandardIndex = -1
  private var currentStandardStartedAtMs: Long = 0
  private var standardAttempts = mutableListOf<StandardAttempt>()
  private var detectedStandard: String? = null
  private var lastTagReport = TagReport()

  override fun getName(): String = "NidVerification"

  @ReactMethod
  fun getNidVerificationNativeStatus(promise: Promise) {
    promise.resolve(
      Arguments.createMap().apply {
        putString("platform", "android")
        putBoolean("nativeLinked", true)
        putBoolean("probeCompiled", BuildConfig.DEBUG)
        putString("module", name)
        putString("version", "0.1.0")
      }
    )
  }

  @ReactMethod
  fun logNidNfcEvent(input: ReadableMap) {
    if (!BuildConfig.DEBUG) return

    val event = input.getStringOrNull("event")
      ?.replace(Regex("[^a-zA-Z0-9_.-]"), "_")
      ?.take(80)
      ?: return
    val details = input.getMap("details")?.toHashMap().orEmpty()
    val safeDetails = DIAGNOSTIC_DETAIL_KEYS.mapNotNull { key ->
      details[key]?.let { value ->
        val sanitized = value.toString().replace(Regex("[\\r\\n;]"), "_").take(120)
        "$key=$sanitized"
      }
    }.joinToString("; ")

    logInfo(
      event = "standard-read:$event",
      details = listOf("source=react-native-nfc-manager", safeDetails)
        .filter { it.isNotEmpty() }
        .joinToString("; ")
    )
  }

  @ReactMethod
  fun probeNidChip(input: ReadableMap, promise: Promise) {
    if (!BuildConfig.DEBUG || !input.getBooleanOrFalse("enabled")) {
      logWarn("probe rejected", details = "reason=disabled_or_non_debug_build")
      promise.reject(CODE_PROBE_DISABLED, "NID NFC probe is available only in explicitly enabled debug builds.")
      return
    }

    val activity = currentActivity
    val adapter = activity?.let { NfcAdapter.getDefaultAdapter(it) }
    if (activity == null || adapter == null) {
      promise.reject(CODE_NFC_UNAVAILABLE, "NFC is unavailable or there is no active Android activity.")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject(CODE_NFC_DISABLED, "NFC is turned off.")
      return
    }

    val sessionId = UUID.randomUUID().toString().take(8)
    synchronized(stateLock) {
      if (pendingPromise != null) {
        promise.reject(CODE_SESSION_BUSY, "Another NID NFC probe is already active.")
        return
      }
      pendingPromise = promise
      pendingActivity = activity
      pendingAdapter = adapter
      pendingSessionId = sessionId
      pendingStartedAtMs = SystemClock.elapsedRealtime()
      activeIsoDep = null
      tagHandled = false
      phaseTransitionScheduled = false
      currentStandardIndex = -1
      currentStandardStartedAtMs = 0
      standardAttempts = mutableListOf()
      detectedStandard = null
      lastTagReport = TagReport()
    }

    logInfo(
      "probe started",
      sessionId,
      "standards=${PROBE_STANDARDS.joinToString(",") { it.name }}; " +
        "phaseTimeoutMs=$PROBE_PHASE_TIMEOUT_MS"
    )
    startProbeStandard(0)
  }

  @ReactMethod
  fun cancelNidProbe(promise: Promise) {
    logInfo("cancel requested", currentSessionId())
    finishError(CODE_USER_CANCELLED, "NID NFC probe cancelled.")
    promise.resolve(null)
  }

  private fun startProbeStandard(index: Int) {
    if (index >= PROBE_STANDARDS.size) {
      finishStandardPolling()
      return
    }

    val standard = PROBE_STANDARDS[index]
    val session = synchronized(stateLock) {
      if (pendingPromise == null) {
        null
      } else {
        currentStandardIndex = index
        currentStandardStartedAtMs = SystemClock.elapsedRealtime()
        tagHandled = false
        phaseTransitionScheduled = false
        pendingSessionId
      }
    } ?: return

    val timeout = Runnable { handleStandardTimeout(index) }
    synchronized(stateLock) {
      if (pendingPromise == null || currentStandardIndex != index) return
      pendingTimeout?.let { mainHandler.removeCallbacks(it) }
      pendingTimeout = timeout
    }

    logInfo(
      "standard phase started",
      session,
      "standard=${standard.name}; standardIndex=$index; timeoutMs=$PROBE_PHASE_TIMEOUT_MS; " +
        "readerFlags=${standard.readerFlagsDescription}; aliases=${standard.aliases.joinToString(",")}"
    )
    mainHandler.postDelayed(timeout, PROBE_PHASE_TIMEOUT_MS)
    mainHandler.post {
      val state = synchronized(stateLock) {
        Triple(pendingActivity, pendingAdapter, pendingPromise != null && currentStandardIndex == index)
      }
      val activity = state.first
      val adapter = state.second
      if (!state.third || activity == null || adapter == null) return@post

      try {
        adapter.enableReaderMode(
          activity,
          NfcAdapter.ReaderCallback { tag -> handleDetectedTag(index, tag) },
          standard.readerFlags or
            if (standard.skipNdefCheck) NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK else 0,
          Bundle().apply {
            putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, PRESENCE_CHECK_DELAY_MS)
          }
        )
        logInfo(
          "reader mode enabled",
          session,
          "standard=${standard.name}; standardIndex=$index"
        )
      } catch (error: Throwable) {
        val report = StandardAttempt(
          standard = standard.name,
          outcome = "session_error",
          durationMs = currentStandardElapsedMs(),
          nativePolling = standard.readerFlagsDescription,
          aliases = standard.aliases,
          errorCategory = CODE_SESSION_FAILED,
          errorType = error.javaClass.simpleName
        )
        logError(
          "reader mode failed",
          session,
          "standard=${standard.name}; standardIndex=$index",
          error
        )
        advanceToNextStandard(index, report)
      }
    }
  }

  private fun handleStandardTimeout(index: Int) {
    val phase = synchronized(stateLock) {
      if (
        pendingPromise == null ||
        currentStandardIndex != index ||
        tagHandled ||
        phaseTransitionScheduled
      ) {
        null
      } else {
        tagHandled = true
        phaseTransitionScheduled = true
        pendingTimeout = null
        Pair(pendingSessionId, currentStandardElapsedMsLocked())
      }
    } ?: return

    val standard = PROBE_STANDARDS[index]
    val report = StandardAttempt(
      standard = standard.name,
      outcome = "timed_out",
      durationMs = phase.second,
      nativePolling = standard.readerFlagsDescription,
      aliases = standard.aliases
    )
    appendStandardAttempt(report)
    logWarn(
      "standard phase timed out",
      phase.first,
      "standard=${standard.name}; standardIndex=$index; durationMs=${phase.second}"
    )
    disableReaderAndScheduleNext(index)
  }

  private fun handleDetectedTag(index: Int, tag: Tag) {
    val sessionId = synchronized(stateLock) {
      if (pendingPromise == null || currentStandardIndex != index || tagHandled) {
        null
      } else {
        tagHandled = true
        pendingTimeout?.let { mainHandler.removeCallbacks(it) }
        pendingTimeout = null
        pendingSessionId
      }
    } ?: return

    val standard = PROBE_STANDARDS[index]

    val technologies = tag.techList.map { it.substringAfterLast('.') }
    val isoDep = IsoDep.get(tag)
    val ndef = Ndef.get(tag)
    val tagReport = buildTagReport(tag, isoDep, ndef)
    synchronized(stateLock) {
      detectedStandard = standard.name
      lastTagReport = tagReport
    }
    logInfo(
      "tag discovered",
      sessionId,
      "standard=${standard.name}; standardIndex=$index; " +
        "technologies=${technologies.joinToString(",")}; hasIsoDep=${isoDep != null}; " +
        "hasNdef=${ndef != null}"
    )

    val requirementMatched = when (standard.requirement) {
      ProbeRequirement.ANY_TAG -> true
      ProbeRequirement.ISO_DEP -> isoDep != null
      ProbeRequirement.NDEF -> ndef != null
    }
    if (!requirementMatched) {
      advanceToNextStandard(
        index,
        StandardAttempt(
          standard = standard.name,
          outcome = "capability_mismatch",
          durationMs = currentStandardElapsedMs(),
          detectedTechnologies = technologies,
          nativePolling = standard.readerFlagsDescription,
          aliases = standard.aliases,
          errorCategory = when (standard.requirement) {
            ProbeRequirement.ISO_DEP -> "ISO_DEP_NOT_SUPPORTED"
            ProbeRequirement.NDEF -> "NDEF_NOT_SUPPORTED"
            ProbeRequirement.ANY_TAG -> "TAG_REQUIREMENT_NOT_MET"
          }
        )
      )
      return
    }

    if (standard.requirement != ProbeRequirement.ISO_DEP) {
      appendStandardAttempt(
        StandardAttempt(
          standard = standard.name,
          outcome = "detected",
          durationMs = currentStandardElapsedMs(),
          detectedTechnologies = technologies,
          nativePolling = standard.readerFlagsDescription,
          aliases = standard.aliases
        )
      )
      finishSuccess(
        buildResult(
          status = "probe_partial",
          sessionId = sessionId,
          tag = tagReport.toWritableMap(),
          attempts = Arguments.createArray(),
          errorCategory = if (standard.requirement == ProbeRequirement.NDEF) {
            "NFC_FORUM_TAG_DETECTED"
          } else {
            "UNSUPPORTED_TAG_TECHNOLOGY"
          },
          errorType = null,
          errorMessage = if (standard.requirement == ProbeRequirement.NDEF) {
            "An NDEF-capable NFC Forum tag was detected."
          } else {
            "A tag was detected, but the current NID APDU probe supports ISO-DEP only."
          }
        )
      )
      return
    }

    if (isoDep == null) return
    probeExecutor.execute {
      connectAndRunProbe(index, tag, isoDep, sessionId, technologies)
    }
  }

  private fun connectAndRunProbe(
    index: Int,
    tag: Tag,
    isoDep: IsoDep,
    sessionId: String,
    technologies: List<String>
  ) {
    val standard = PROBE_STANDARDS[index]
    try {
      synchronized(stateLock) {
        if (pendingPromise == null || currentStandardIndex != index) return
        activeIsoDep = isoDep
      }
      logInfo("IsoDep connect started", sessionId, "standard=${standard.name}")
      isoDep.connect()
      isoDep.timeout = ISO_DEP_TIMEOUT_MS
      appendStandardAttempt(
        StandardAttempt(
          standard = standard.name,
          outcome = "detected",
          durationMs = currentStandardElapsedMs(),
          detectedTechnologies = technologies,
          nativePolling = standard.readerFlagsDescription,
          aliases = standard.aliases
        )
      )
      runProbe(tag, isoDep, sessionId)
    } catch (error: Throwable) {
      val report = StandardAttempt(
        standard = standard.name,
        outcome = "connect_failed",
        durationMs = currentStandardElapsedMs(),
        detectedTechnologies = technologies,
        nativePolling = standard.readerFlagsDescription,
        aliases = standard.aliases,
        errorCategory = classifyTransportError(error),
        errorType = error.javaClass.simpleName
      )
      logError(
        "IsoDep connect failed",
        sessionId,
        "standard=${standard.name}; category=${report.errorCategory}; " +
          "errorType=${report.errorType}",
        error
      )
      try {
        isoDep.close()
      } catch (closeError: Throwable) {
        logWarn("IsoDep close failed", sessionId, throwable = closeError)
      }
      synchronized(stateLock) {
        if (activeIsoDep === isoDep) activeIsoDep = null
      }
      advanceToNextStandard(index, report)
    }
  }

  private fun advanceToNextStandard(index: Int, report: StandardAttempt) {
    val shouldAdvance = synchronized(stateLock) {
      if (
        pendingPromise == null ||
        currentStandardIndex != index ||
        phaseTransitionScheduled
      ) {
        false
      } else {
        tagHandled = true
        phaseTransitionScheduled = true
        pendingTimeout?.let { mainHandler.removeCallbacks(it) }
        pendingTimeout = null
        true
      }
    }
    if (!shouldAdvance) return

    appendStandardAttempt(report)
    disableReaderAndScheduleNext(index)
  }

  private fun disableReaderAndScheduleNext(index: Int) {
    mainHandler.post {
      val state = synchronized(stateLock) {
        Triple(pendingActivity, pendingAdapter, pendingPromise != null && currentStandardIndex == index)
      }
      if (!state.third) return@post

      if (state.first != null && state.second != null) {
        try {
          state.second!!.disableReaderMode(state.first!!)
        } catch (error: Throwable) {
          logWarn("reader mode transition cleanup failed", currentSessionId(), throwable = error)
        }
      }
      mainHandler.postDelayed(
        { startProbeStandard(index + 1) },
        STANDARD_TRANSITION_DELAY_MS
      )
    }
  }

  private fun finishStandardPolling() {
    val snapshot = synchronized(stateLock) {
      if (pendingPromise == null) {
        null
      } else {
        Triple(pendingSessionId, detectedStandard, lastTagReport)
      }
    } ?: return

    val tagWasDetected = snapshot.second != null
    finishSuccess(
      buildResult(
        status = if (tagWasDetected) "probe_partial" else "probe_failed",
        sessionId = snapshot.first ?: "unknown",
        tag = snapshot.third.toWritableMap(),
        attempts = Arguments.createArray(),
        errorCategory = if (tagWasDetected) {
          "NO_COMPATIBLE_TAG_COMMUNICATION"
        } else {
          "NO_COMPATIBLE_TAG_DETECTED"
        },
        errorType = null,
        errorMessage = if (tagWasDetected) {
          "An NFC tag was detected, but no compatible communication path completed."
        } else {
          "No compatible NFC tag was detected during any 20-second polling phase."
        }
      )
    )
  }

  private fun runProbe(tag: Tag, isoDep: IsoDep, sessionId: String) {
    val attempts = Arguments.createArray()
    var selectedProfile: String? = null
    var responseCount = 0

    try {
      logInfo(
        "IsoDep connected",
        sessionId,
        "maxTransceiveLength=${isoDep.maxTransceiveLength}; timeoutMs=${isoDep.timeout}; " +
          "historicalBytesLength=${isoDep.historicalBytes?.size ?: 0}; " +
          "hiLayerResponseLength=${isoDep.hiLayerResponse?.size ?: 0}"
      )

      profileLoop@ for (profile in PROFILES) {
        logInfo("profile started", sessionId, "profile=${profile.name}")
        var foundDer = false

        for (command in profile.commands) {
          val result = transmit(isoDep, profile.name, command, sessionId)
          attempts.pushMap(result.report)
          if (result.hadResponse) responseCount += 1

          if (result.looksLikeDer) {
            foundDer = true
          }
          if (!result.accepted && !command.optional) {
            logInfo(
              "profile rejected",
              sessionId,
              "profile=${profile.name}; command=${command.name}; statusWord=${result.statusWord ?: "none"}"
            )
            continue@profileLoop
          }
        }

        if (foundDer) {
          selectedProfile = profile.name
          logInfo("profile matched", sessionId, "profile=${profile.name}")
          break
        }
        logInfo(
          "profile did not match",
          sessionId,
          "profile=${profile.name}; looksLikeDer=$foundDer"
        )
      }

      val status = when {
        selectedProfile != null -> "probe_success"
        responseCount > 0 -> "probe_partial"
        else -> "probe_failed"
      }
      finishSuccess(
        buildResult(
          status = status,
          sessionId = sessionId,
          tag = buildTagMap(tag, isoDep),
          attempts = attempts,
          selectedProfile = selectedProfile
        )
      )
    } catch (error: Throwable) {
      if (error is ProbeTransportException) {
        attempts.pushMap(error.report)
      }
      val category = classifyTransportError(error)
      logError(
        "probe transport failed",
        sessionId,
        "category=$category; errorType=${error.javaClass.simpleName}; message=${error.message}",
        error
      )
      finishSuccess(
        buildResult(
          status = "probe_failed",
          sessionId = sessionId,
          tag = buildTagMap(tag, isoDep),
          attempts = attempts,
          selectedProfile = selectedProfile,
          errorCategory = category,
          errorType = error.javaClass.simpleName,
          errorMessage = error.message ?: "NFC transport failed."
        )
      )
    }
  }

  private fun transmit(
    isoDep: IsoDep,
    profile: String,
    command: ProbeCommand,
    sessionId: String
  ): TransmitResult {
    val startedAt = SystemClock.elapsedRealtime()
    logInfo(
      "APDU send",
      sessionId,
      "profile=$profile; command=${command.name}; optional=${command.optional}; byteLength=${command.bytes.size}"
    )

    return try {
      var response = isoDep.transceive(command.bytes)
      var parsed = parseResponse(response)

      if (parsed.statusWord.startsWith("6C") && command.canRetryWrongLength) {
        val correctedLength = parsed.statusWord.takeLast(2).toInt(16)
        val correctedCommand = command.bytes.copyOf().apply {
          this[lastIndex] = correctedLength.toByte()
        }
        logInfo(
          "APDU retry wrong length",
          sessionId,
          "profile=$profile; command=${command.name}; correctedLength=$correctedLength"
        )
        response = isoDep.transceive(correctedCommand)
        parsed = parseResponse(response)
      }

      val collected = parsed.data.toMutableList()
      var continuationCount = 0
      while (parsed.statusWord.startsWith("61") && continuationCount < MAX_GET_RESPONSE_COUNT) {
        val expectedLength = parsed.statusWord.takeLast(2).toInt(16)
        val getResponse = byteArrayOf(
          0x00,
          0xC0.toByte(),
          0x00,
          0x00,
          expectedLength.toByte()
        )
        response = isoDep.transceive(getResponse)
        parsed = parseResponse(response)
        collected.addAll(parsed.data.toList())
        continuationCount += 1
      }

      val statusWord = parsed.statusWord
      val accepted = isAcceptedStatus(statusWord)
      val warning = statusWord.startsWith("62") || statusWord.startsWith("63")
      val looksLikeDer = command.checkDer && collected.firstOrNull()?.toInt()?.and(0xFF) == 0x30
      val durationMs = SystemClock.elapsedRealtime() - startedAt
      val outcome = when {
        !accepted -> "rejected"
        warning -> "warning"
        else -> "ok"
      }

      logInfo(
        "APDU result",
        sessionId,
        "profile=$profile; command=${command.name}; statusWord=$statusWord; " +
          "responseLength=${collected.size}; durationMs=$durationMs; outcome=$outcome; " +
          "looksLikeDer=$looksLikeDer"
      )

      TransmitResult(
        accepted = accepted,
        hadResponse = true,
        looksLikeDer = looksLikeDer,
        statusWord = statusWord,
        report = Arguments.createMap().apply {
          putString("profile", profile)
          putString("command", command.name)
          putString("outcome", outcome)
          putDouble("durationMs", durationMs.toDouble())
          putBoolean("optional", command.optional)
          putInt("responseLength", collected.size)
          putString("statusWord", statusWord)
          if (command.checkDer) putBoolean("looksLikeDer", looksLikeDer)
        }
      )
    } catch (error: Throwable) {
      val durationMs = SystemClock.elapsedRealtime() - startedAt
      val category = classifyTransportError(error)
      val report = Arguments.createMap().apply {
        putString("profile", profile)
        putString("command", command.name)
        putString("outcome", "transport_error")
        putDouble("durationMs", durationMs.toDouble())
        putBoolean("optional", command.optional)
        putString("errorCategory", category)
        putString("errorType", error.javaClass.simpleName)
      }
      logError(
        "APDU transport error",
        sessionId,
        "profile=$profile; command=${command.name}; category=$category; " +
          "errorType=${error.javaClass.simpleName}; durationMs=$durationMs",
        error
      )
      throw ProbeTransportException(report, error)
    }
  }

  private fun buildTagMap(tag: Tag, isoDep: IsoDep?): WritableMap {
    return buildTagReport(tag, isoDep, Ndef.get(tag)).toWritableMap()
  }

  private fun buildTagReport(tag: Tag, isoDep: IsoDep?, ndef: Ndef?): TagReport {
    val isConnected = isoDep?.isConnected == true
    return TagReport(
      technologies = tag.techList.map { it.substringAfterLast('.') },
      isoDepSupported = isoDep != null,
      ndefSupported = ndef != null,
      ndefType = ndef?.type,
      ndefCapacity = ndef?.maxSize,
      maxTransceiveLength = if (isConnected) isoDep?.maxTransceiveLength else null,
      timeoutMs = if (isConnected) isoDep?.timeout else null,
      historicalBytesLength = if (isConnected) isoDep?.historicalBytes?.size else null,
      applicationDataLength = if (isConnected) isoDep?.hiLayerResponse?.size else null
    )
  }

  private fun buildResult(
    status: String,
    sessionId: String,
    tag: WritableMap,
    attempts: WritableArray,
    selectedProfile: String? = null,
    errorCategory: String? = null,
    errorType: String? = null,
    errorMessage: String? = null
  ): WritableMap {
    return Arguments.createMap().apply {
      putString("status", status)
      putString("platform", "android")
      putString("sessionId", sessionId)
      putDouble("durationMs", elapsedMs().toDouble())
      putMap("tag", tag)
      putArray("attempts", attempts)
      putArray("standardAttempts", standardAttemptsSnapshot())
      detectedStandardSnapshot()?.let { putString("detectedStandard", it) }
      if (selectedProfile != null) putString("selectedProfile", selectedProfile)
      if (errorCategory != null && errorMessage != null) {
        putMap(
          "error",
          Arguments.createMap().apply {
            putString("category", errorCategory)
            if (errorType != null) putString("type", errorType)
            putString("message", errorMessage)
          }
        )
      }
    }
  }

  private fun finishSuccess(result: WritableMap) {
    val snapshot = takeSessionSnapshot() ?: return
    logInfo("probe completed", snapshot.sessionId, "durationMs=${elapsedMs(snapshot.startedAtMs)}")
    cleanup(snapshot)
    snapshot.promise.resolve(result)
  }

  private fun finishError(code: String, message: String, error: Throwable? = null) {
    val snapshot = takeSessionSnapshot() ?: return
    logWarn(
      "probe failed",
      snapshot.sessionId,
      "code=$code; durationMs=${elapsedMs(snapshot.startedAtMs)}; message=$message",
      error
    )
    cleanup(snapshot)
    snapshot.promise.reject(code, message, error)
  }

  private fun takeSessionSnapshot(): SessionSnapshot? {
    synchronized(stateLock) {
      val promise = pendingPromise ?: return null
      val snapshot = SessionSnapshot(
        promise = promise,
        activity = pendingActivity,
        adapter = pendingAdapter,
        isoDep = activeIsoDep,
        timeout = pendingTimeout,
        sessionId = pendingSessionId,
        startedAtMs = pendingStartedAtMs
      )
      pendingPromise = null
      pendingActivity = null
      pendingAdapter = null
      pendingSessionId = null
      pendingStartedAtMs = 0
      pendingTimeout = null
      activeIsoDep = null
      tagHandled = false
      phaseTransitionScheduled = false
      currentStandardIndex = -1
      currentStandardStartedAtMs = 0
      standardAttempts = mutableListOf()
      detectedStandard = null
      lastTagReport = TagReport()
      return snapshot
    }
  }

  private fun cleanup(snapshot: SessionSnapshot) {
    snapshot.timeout?.let { mainHandler.removeCallbacks(it) }
    try {
      snapshot.isoDep?.close()
    } catch (error: Throwable) {
      logWarn("IsoDep close failed", snapshot.sessionId, throwable = error)
    }
    if (snapshot.activity != null && snapshot.adapter != null) {
      mainHandler.post {
        try {
          snapshot.adapter.disableReaderMode(snapshot.activity)
        } catch (error: Throwable) {
          logWarn("reader mode cleanup failed", snapshot.sessionId, throwable = error)
        }
      }
    }
  }

  private fun currentSessionId(): String? = synchronized(stateLock) { pendingSessionId }

  private fun appendStandardAttempt(attempt: StandardAttempt) {
    synchronized(stateLock) {
      standardAttempts.add(attempt)
    }
  }

  private fun standardAttemptsSnapshot(): WritableArray {
    val snapshot = synchronized(stateLock) { standardAttempts.toList() }
    return Arguments.createArray().apply {
      snapshot.forEach { pushMap(it.toWritableMap()) }
    }
  }

  private fun detectedStandardSnapshot(): String? = synchronized(stateLock) { detectedStandard }

  private fun currentStandardElapsedMs(): Long = synchronized(stateLock) {
    currentStandardElapsedMsLocked()
  }

  private fun currentStandardElapsedMsLocked(): Long {
    return if (currentStandardStartedAtMs > 0) {
      SystemClock.elapsedRealtime() - currentStandardStartedAtMs
    } else {
      0
    }
  }

  private fun elapsedMs(startedAtMs: Long = synchronized(stateLock) { pendingStartedAtMs }): Long {
    return if (startedAtMs > 0) SystemClock.elapsedRealtime() - startedAtMs else 0
  }

  private fun parseResponse(response: ByteArray): ParsedResponse {
    if (response.size < 2) {
      return ParsedResponse(response, "INVALID")
    }
    val sw1 = response[response.size - 2].toInt() and 0xFF
    val sw2 = response[response.size - 1].toInt() and 0xFF
    return ParsedResponse(
      data = response.copyOfRange(0, response.size - 2),
      statusWord = String.format("%02X%02X", sw1, sw2)
    )
  }

  private fun isAcceptedStatus(statusWord: String): Boolean {
    return statusWord == "9000" ||
      statusWord.startsWith("61") ||
      statusWord.startsWith("62") ||
      statusWord.startsWith("63")
  }

  private fun classifyTransportError(error: Throwable): String {
    val source = if (error is ProbeTransportException) error.cause ?: error else error
    return when (source) {
      is TagLostException -> "TAG_LOST"
      is SecurityException -> "SECURITY_ERROR"
      is IOException -> {
        if (source.message?.contains("timeout", ignoreCase = true) == true) {
          "TRANSCEIVE_TIMEOUT"
        } else {
          "TRANSCEIVE_IO_ERROR"
        }
      }
      else -> "TRANSCEIVE_ERROR"
    }
  }

  private fun logInfo(event: String, sessionId: String? = null, details: String? = null) {
    Log.i(LOG_TAG, formatLog(event, sessionId, details))
  }

  private fun logWarn(
    event: String,
    sessionId: String? = null,
    details: String? = null,
    throwable: Throwable? = null
  ) {
    Log.w(LOG_TAG, formatLog(event, sessionId, details), throwable)
  }

  private fun logError(
    event: String,
    sessionId: String? = null,
    details: String? = null,
    throwable: Throwable? = null
  ) {
    Log.e(LOG_TAG, formatLog(event, sessionId, details), throwable)
  }

  private fun formatLog(event: String, sessionId: String?, details: String?): String {
    return buildList {
      add("event=$event")
      if (sessionId != null) add("sessionId=$sessionId")
      add("elapsedMs=${elapsedMs()}")
      if (details != null) add(details)
    }.joinToString("; ")
  }

  private fun ReadableMap.getBooleanOrFalse(key: String): Boolean {
    return hasKey(key) && !isNull(key) && getBoolean(key)
  }

  private fun ReadableMap.getStringOrNull(key: String): String? {
    return if (hasKey(key) && !isNull(key)) getString(key) else null
  }

  private data class ProbeProfile(
    val name: String,
    val commands: List<ProbeCommand>
  )

  private data class ProbeCommand(
    val name: String,
    val bytes: ByteArray,
    val optional: Boolean = false,
    val checkDer: Boolean = false,
    val canRetryWrongLength: Boolean = false
  )

  private data class ParsedResponse(
    val data: ByteArray,
    val statusWord: String
  )

  private data class TransmitResult(
    val accepted: Boolean,
    val hadResponse: Boolean,
    val looksLikeDer: Boolean,
    val statusWord: String?,
    val report: WritableMap
  )

  private data class ProbeStandard(
    val name: String,
    val readerFlags: Int,
    val readerFlagsDescription: String,
    val aliases: List<String>,
    val requirement: ProbeRequirement,
    val skipNdefCheck: Boolean = true
  )

  private enum class ProbeRequirement {
    ANY_TAG,
    ISO_DEP,
    NDEF
  }

  private data class StandardAttempt(
    val standard: String,
    val outcome: String,
    val durationMs: Long,
    val detectedTechnologies: List<String> = emptyList(),
    val nativePolling: String? = null,
    val aliases: List<String> = emptyList(),
    val errorCategory: String? = null,
    val errorType: String? = null
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putString("standard", standard)
        putString("outcome", outcome)
        putDouble("durationMs", durationMs.toDouble())
        nativePolling?.let { putString("nativePolling", it) }
        if (aliases.isNotEmpty()) {
          putArray(
            "aliases",
            Arguments.createArray().apply {
              aliases.forEach { pushString(it) }
            }
          )
        }
        if (detectedTechnologies.isNotEmpty()) {
          putArray(
            "detectedTechnologies",
            Arguments.createArray().apply {
              detectedTechnologies.forEach { pushString(it) }
            }
          )
        }
        errorCategory?.let { putString("errorCategory", it) }
        errorType?.let { putString("errorType", it) }
      }
    }
  }

  private data class TagReport(
    val technologies: List<String> = emptyList(),
    val isoDepSupported: Boolean = false,
    val ndefSupported: Boolean = false,
    val ndefType: String? = null,
    val ndefCapacity: Int? = null,
    val maxTransceiveLength: Int? = null,
    val timeoutMs: Int? = null,
    val historicalBytesLength: Int? = null,
    val applicationDataLength: Int? = null
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putArray(
          "technologies",
          Arguments.createArray().apply {
            technologies.forEach { pushString(it) }
          }
        )
        putBoolean("isoDepSupported", isoDepSupported)
        putBoolean("ndefSupported", ndefSupported)
        ndefType?.let { putString("ndefType", it) }
        ndefCapacity?.let { putInt("ndefCapacity", it) }
        maxTransceiveLength?.let { putInt("maxTransceiveLength", it) }
        timeoutMs?.let { putInt("timeoutMs", it) }
        historicalBytesLength?.let { putInt("historicalBytesLength", it) }
        applicationDataLength?.let { putInt("applicationDataLength", it) }
      }
    }
  }

  private data class SessionSnapshot(
    val promise: Promise,
    val activity: Activity?,
    val adapter: NfcAdapter?,
    val isoDep: IsoDep?,
    val timeout: Runnable?,
    val sessionId: String?,
    val startedAtMs: Long
  )

  private class ProbeTransportException(
    val report: WritableMap,
    cause: Throwable
  ) : Exception(cause)

  companion object {
    private const val LOG_TAG = "NidVerificationModule"
    private const val CODE_PROBE_DISABLED = "NID_PROBE_DISABLED"
    private const val CODE_NFC_UNAVAILABLE = "NID_NFC_UNAVAILABLE"
    private const val CODE_NFC_DISABLED = "NID_NFC_DISABLED"
    private const val CODE_SESSION_BUSY = "NID_NFC_SESSION_BUSY"
    private const val CODE_SESSION_FAILED = "NID_NFC_SESSION_FAILED"
    private const val CODE_USER_CANCELLED = "NID_NFC_USER_CANCELLED"
    private const val PROBE_PHASE_TIMEOUT_MS = 20_000L
    private const val STANDARD_TRANSITION_DELAY_MS = 300L
    private const val ISO_DEP_TIMEOUT_MS = 8_000
    private const val PRESENCE_CHECK_DELAY_MS = 250
    private const val MAX_GET_RESPONSE_COUNT = 4
    private val DIAGNOSTIC_DETAIL_KEYS = listOf(
      "stage",
      "profile",
      "command",
      "statusWord",
      "responseLength",
      "durationMs",
      "offset",
      "requestedLength",
      "chunkCount",
      "certificateLength",
      "hasSigningCertificate",
      "hasAuthenticationCertificate",
      "errorCategory",
      "errorType"
    )
    private val PROBE_STANDARDS = listOf(
      ProbeStandard(
        name = "nfc-forum-tags",
        readerFlags = NfcAdapter.FLAG_READER_NFC_A or
          NfcAdapter.FLAG_READER_NFC_B or
          NfcAdapter.FLAG_READER_NFC_F or
          NfcAdapter.FLAG_READER_NFC_V,
        readerFlagsDescription = "NFC_A|NFC_B|NFC_F|NFC_V",
        aliases = listOf("NFC Forum Type 1-5"),
        requirement = ProbeRequirement.NDEF,
        skipNdefCheck = false
      ),
      ProbeStandard(
        name = "iso-dep-iso7816",
        readerFlags = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B,
        readerFlagsDescription = "NFC_A|NFC_B|SKIP_NDEF_CHECK",
        aliases = listOf("ISO-DEP", "ISO 7816 over NFC"),
        requirement = ProbeRequirement.ISO_DEP
      ),
      ProbeStandard(
        name = "iso14443-a",
        readerFlags = NfcAdapter.FLAG_READER_NFC_A,
        readerFlagsDescription = "NFC_A|SKIP_NDEF_CHECK",
        aliases = listOf("ISO 14443-A", "NFC-A"),
        requirement = ProbeRequirement.ANY_TAG
      ),
      ProbeStandard(
        name = "iso14443-b",
        readerFlags = NfcAdapter.FLAG_READER_NFC_B,
        readerFlagsDescription = "NFC_B|SKIP_NDEF_CHECK",
        aliases = listOf("ISO 14443-B", "NFC-B"),
        requirement = ProbeRequirement.ANY_TAG
      ),
      ProbeStandard(
        name = "iso15693",
        readerFlags = NfcAdapter.FLAG_READER_NFC_V,
        readerFlagsDescription = "NFC_V|SKIP_NDEF_CHECK",
        aliases = listOf("ISO 15693", "NFC-V"),
        requirement = ProbeRequirement.ANY_TAG
      ),
      ProbeStandard(
        name = "iso18092-felica",
        readerFlags = NfcAdapter.FLAG_READER_NFC_F,
        readerFlagsDescription = "NFC_F|SKIP_NDEF_CHECK",
        aliases = listOf("ISO 18092", "FeliCa", "NFC-F"),
        requirement = ProbeRequirement.ANY_TAG
      )
    )

    private fun apdu(hex: String): ByteArray {
      return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private val PROFILES = listOf(
      ProbeProfile(
        "pardis-signing",
        listOf(
          ProbeCommand("select_pardis_app", apdu("00A404000F5041524449532C4D41544952414E20")),
          ProbeCommand("select_df_5100", apdu("00A40000025100")),
          ProbeCommand("select_ef_5040", apdu("00A40200025040")),
          ProbeCommand(
            "read_certificate_header",
            apdu("00B0000004"),
            checkDer = true,
            canRetryWrongLength = true
          )
        )
      ),
      ProbeProfile(
        "mav4-signing",
        listOf(
          ProbeCommand("select_card_manager", apdu("00A4040008A000000018434D00")),
          ProbeCommand("read_cplc", apdu("80CA9F7F2D"), optional = true),
          ProbeCommand("select_ias_app", apdu("00A404000CA0000000180C000001634200")),
          ProbeCommand("select_mf", apdu("00A40000023F00")),
          ProbeCommand("select_df_5100", apdu("00A40000025100")),
          ProbeCommand("select_ef_5040", apdu("00A4020C025040")),
          ProbeCommand(
            "read_certificate_header",
            apdu("00B0000004"),
            checkDer = true,
            canRetryWrongLength = true
          )
        )
      ),
      ProbeProfile(
        "mav4-authentication",
        listOf(
          ProbeCommand("select_ias_app", apdu("00A404000CA0000000180C000001634200")),
          ProbeCommand("select_card_manager", apdu("00A4040008A000000018434D00")),
          ProbeCommand("read_cplc", apdu("80CA9F7F2D"), optional = true),
          ProbeCommand("reselect_ias_app", apdu("00A404000CA0000000180C000001634200")),
          ProbeCommand("select_mf", apdu("00A40000023F00")),
          ProbeCommand("select_df_5000", apdu("00A40000025000")),
          ProbeCommand("select_ef_5040", apdu("00A4020C025040")),
          ProbeCommand("select_ef_0303", apdu("00A4020C020303")),
          ProbeCommand(
            "read_certificate_header",
            apdu("00B0000004"),
            checkDer = true,
            canRetryWrongLength = true
          )
        )
      )
    )
  }
}
