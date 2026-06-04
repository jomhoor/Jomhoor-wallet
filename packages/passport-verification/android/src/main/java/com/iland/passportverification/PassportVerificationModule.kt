package com.iland.passportverification

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.IsoDep
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule
import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.CardServiceException
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.jmrtd.BACDeniedException
import org.jmrtd.BACKey
import org.jmrtd.BACKeySpec
import org.jmrtd.PACEException
import org.jmrtd.PassportService
import org.jmrtd.lds.CardAccessFile
import org.jmrtd.lds.PACEInfo
import org.jmrtd.lds.SecurityInfo
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.COMFile
import org.jmrtd.lds.icao.DG11File
import org.jmrtd.lds.icao.DG12File
import org.jmrtd.lds.icao.DG15File
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.DG2File
import org.jmrtd.lds.icao.MRZInfo
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.security.Security
import java.text.SimpleDateFormat
import java.util.Date
import java.util.LinkedHashMap
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class PassportVerificationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val stateLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val readExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  private var pendingPromise: Promise? = null
  private var pendingConfig: ReadConfig? = null
  private var pendingActivity: Activity? = null
  private var pendingAdapter: NfcAdapter? = null
  private var pendingTimeoutRunnable: Runnable? = null
  private var hasHandledTag = false
  private var cancelRequested = false
  private var activeIsoDep: IsoDep? = null
  private var pendingSessionDebug: SessionDebugState? = null

  override fun getName(): String = "PassportVerification"

  @ReactMethod
  fun getPassportVerificationNativeStatus(promise: Promise) {
    val result = Arguments.createMap()
    result.putString("platform", "android")
    result.putBoolean("nativeLinked", true)
    result.putString("module", "PassportVerification")
    result.putString("version", "0.1.0")
    promise.resolve(result)
  }

  @ReactMethod
  fun readPassport(input: ReadableMap, promise: Promise) {
    logInfo(
      event = "readPassport invoked",
      details = buildReadPassportInputSummary(input)
    )

    val config = try {
      parseReadConfig(input)
    } catch (error: BridgeException) {
      logWarn(
        event = "readPassport input validation failed",
        details = "code=${error.code}; message=${error.message}",
        throwable = error
      )
      rejectBridgeError(promise, error.toBridgeError())
      return
    } catch (error: Throwable) {
      logWarn(
        event = "readPassport input parsing failed",
        details = "errorClass=${error.javaClass.simpleName}; message=${error.message}",
        throwable = error
      )
      promise.reject(CODE_INVALID_INPUT, error.message ?: "Invalid passport NFC input.", error)
      return
    }

    logInfo(
      event = "readPassport input validated",
      details = buildConfigSummaryForLog(config)
    )

    val activity = currentActivity
    if (activity == null) {
      logWarn(event = "No active Android activity for NFC session")
      promise.reject(
        CODE_NFC_SESSION_INVALIDATED,
        "Passport NFC reading requires an active Android activity."
      )
      return
    }

    val adapter = NfcAdapter.getDefaultAdapter(activity)
    if (adapter == null) {
      logWarn(event = "NFC adapter unavailable on device")
      promise.reject(
        CODE_PASSPORT_READ_FAILED,
        "Passport NFC reading is unavailable because this device does not support NFC."
      )
      return
    }
    if (!adapter.isEnabled) {
      logWarn(event = "NFC adapter present but disabled")
      promise.reject(
        CODE_NFC_SESSION_INVALIDATED,
        "Passport NFC reading is unavailable because NFC is turned off."
      )
      return
    }

    val sessionId = generateSessionId()
    val sessionStartElapsedMs = SystemClock.elapsedRealtime()
    synchronized(stateLock) {
      if (pendingPromise != null) {
        logWarn(
          event = "readPassport rejected because another session is in progress",
          sessionId = sessionId
        )
        promise.reject(CODE_NFC_SESSION_BUSY, "A passport read is already in progress.")
        return
      }

      pendingPromise = promise
      pendingConfig = config
      pendingActivity = activity
      pendingAdapter = adapter
      hasHandledTag = false
      cancelRequested = false
      activeIsoDep = null
      pendingSessionDebug = SessionDebugState(
        sessionId = sessionId,
        startElapsedMs = sessionStartElapsedMs,
        stage = SessionStage.WAITING_FOR_TAG
      )
    }

    logStage(
      stage = SessionStage.WAITING_FOR_TAG,
      sessionId = sessionId,
      details = "Session registered and waiting for NFC tag"
    )

    val timeoutRunnable = Runnable {
      val snapshot = captureDebugSnapshot()
      logWarn(
        event = "Timeout watchdog fired",
        sessionId = snapshot.sessionId ?: sessionId,
        stage = snapshot.stage,
        elapsedMs = snapshot.elapsedMs,
        details = "configuredTimeoutMs=$SESSION_TIMEOUT_MS; lastSuccessfulStep=${snapshot.lastSuccessfulStep ?: "none"}"
      )
      finishWithError(
        BridgeError(
          code = CODE_NFC_TIMEOUT,
          message = "The NFC session timed out before the passport finished reading."
        )
      )
    }
    synchronized(stateLock) {
      pendingTimeoutRunnable = timeoutRunnable
    }
    mainHandler.postDelayed(timeoutRunnable, SESSION_TIMEOUT_MS)
    logInfo(
      event = "Timeout watchdog started",
      sessionId = sessionId,
      stage = SessionStage.WAITING_FOR_TAG,
      details = "timeoutMs=$SESSION_TIMEOUT_MS"
    )

    mainHandler.post {
      try {
        val options = Bundle().apply {
          putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
        }
        logInfo(
          event = "Enabling NFC reader mode",
          sessionId = sessionId,
          stage = SessionStage.WAITING_FOR_TAG,
          details = "presenceCheckDelayMs=250; flags=NFC_A|NFC_B|SKIP_NDEF_CHECK"
        )
        adapter.enableReaderMode(
          activity,
          readerCallback,
          NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
          options
        )
        logInfo(
          event = "NFC reader mode enabled",
          sessionId = sessionId,
          stage = SessionStage.WAITING_FOR_TAG
        )
      } catch (error: Throwable) {
        logError(
          event = "Failed to enable NFC reader mode",
          sessionId = sessionId,
          stage = SessionStage.WAITING_FOR_TAG,
          details = "errorClass=${error.javaClass.simpleName}; message=${error.message}",
          throwable = error
        )
        finishWithError(
          BridgeError(
            code = CODE_NFC_SESSION_INVALIDATED,
            message = "Failed to start Android NFC reader mode.",
            cause = error
          )
        )
      }
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    logInfo(event = "disconnect invoked")
    cancelActiveRead()
    promise.resolve(null)
  }

  @ReactMethod
  fun cancelSession(promise: Promise) {
    logInfo(event = "cancelSession invoked")
    cancelActiveRead()
    promise.resolve(null)
  }

  @ReactMethod
  fun clearTemporaryData(promise: Promise) {
    logInfo(event = "clearTemporaryData invoked")
    cancelActiveRead()
    promise.resolve(null)
  }

  private val readerCallback = NfcAdapter.ReaderCallback { tag ->
    val activeSession = synchronized(stateLock) {
      val activeConfig = pendingConfig
      val activePromise = pendingPromise
      val debug = pendingSessionDebug
      if (activeConfig == null || activePromise == null || hasHandledTag || debug == null) {
        logWarn(
          event = "Ignoring discovered tag because no readable session is active",
          details = "hasConfig=${activeConfig != null}; hasPromise=${activePromise != null}; hasHandledTag=$hasHandledTag; hasDebug=${debug != null}; tag=${buildTagDiagnostics(tag)}"
        )
        null
      } else {
        hasHandledTag = true
        ReaderSessionContext(activeConfig, debug.sessionId)
      }
    } ?: return@ReaderCallback

    val sessionId = activeSession.sessionId
    val techListSummary = tag?.techList?.joinToString(", ").orEmpty()
    val isoDep = tag?.let { IsoDep.get(it) }
    logStage(
      stage = SessionStage.TAG_DISCOVERED,
      sessionId = sessionId,
      details = buildTagDiagnostics(tag, isoDep)
    )

    if (tag == null || isoDep == null) {
      logWarn(
        event = "Detected tag is not ISO-DEP",
        sessionId = sessionId,
        stage = SessionStage.TAG_DISCOVERED,
        details = "techList=[$techListSummary]; tag=${buildTagDiagnostics(tag, isoDep)}"
      )
      finishWithError(
        BridgeError(
          code = CODE_NON_ISO7816_TAG,
          message = "Detected tag is not an ISO7816 passport chip."
        )
      )
      return@ReaderCallback
    }

    readExecutor.execute {
      runReadSession(tag, activeSession.config, sessionId)
    }
  }

  private fun runReadSession(tag: Tag, config: ReadConfig, sessionId: String) {
    var cardService: CardService? = null
    var passportService: PassportService? = null
    var isoDepForRead: IsoDep? = null

    try {
      ensureNotCanceled()
      setStage(SessionStage.ISODEP_CONNECTING, sessionId)
      logInfo(event = "IsoDep acquisition started", sessionId = sessionId)
      val isoDep = IsoDep.get(tag)
        ?: throw BridgeException(
          CODE_NON_ISO7816_TAG,
          "Detected tag is not an ISO7816 passport chip."
        )
      isoDepForRead = isoDep
      synchronized(stateLock) {
        activeIsoDep = isoDep
      }
      logInfo(
        event = "IsoDep acquired",
        sessionId = sessionId,
        stage = SessionStage.ISODEP_CONNECTING,
        details = buildIsoDepDiagnostics(isoDep)
      )
      if (!isoDep.isConnected) {
        logInfo(event = "IsoDep.connect start", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTING)
        isoDep.connect()
      }
      setStage(SessionStage.ISODEP_CONNECTED, sessionId, markSuccessfulStep = "ISODEP_CONNECTED")
      logInfo(
        event = "IsoDep connected",
        sessionId = sessionId,
        stage = SessionStage.ISODEP_CONNECTED,
        details = buildIsoDepDiagnostics(isoDep)
      )
      isoDep.timeout = ISO_DEP_TIMEOUT_MS
      logInfo(
        event = "IsoDep timeout configured",
        sessionId = sessionId,
        stage = SessionStage.ISODEP_CONNECTED,
        details = "isoDepTimeoutMs=$ISO_DEP_TIMEOUT_MS; ${buildIsoDepDiagnostics(isoDep)}"
      )

      logInfo(event = "CardService creation", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTED)
      cardService = CardService.getInstance(isoDep)
      logInfo(event = "CardService.open start", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTED)
      cardService.open()
      logInfo(event = "CardService.open success", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTED)

      logInfo(event = "PassportService creation", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTED)
      passportService = PassportService(
        cardService,
        PassportService.NORMAL_MAX_TRANCEIVE_LENGTH,
        PassportService.DEFAULT_MAX_BLOCKSIZE,
        false,
        false
      )
      logInfo(event = "PassportService.open start", sessionId = sessionId, stage = SessionStage.ISODEP_CONNECTED)
      passportService.open()
      logInfo(
        event = "PassportService.open success",
        sessionId = sessionId,
        stage = SessionStage.ISODEP_CONNECTED,
        details = "maxTransceiveLength=${PassportService.NORMAL_MAX_TRANCEIVE_LENGTH}; maxBlockSize=${PassportService.DEFAULT_MAX_BLOCKSIZE}"
      )

      val result = readPassportPayload(passportService, config, sessionId)
      setStage(SessionStage.COMPLETING, sessionId, markSuccessfulStep = "READ_COMPLETED")
      logInfo(event = "Read session completed successfully", sessionId = sessionId, stage = SessionStage.COMPLETING)
      finishWithSuccess(result)
    } catch (error: Throwable) {
      val mapped = mapError(error)
      logError(
        event = "Read session failed",
        sessionId = sessionId,
        details = "mappedCode=${mapped.code}; errorClass=${error.javaClass.simpleName}; message=${mapped.message}",
        throwable = error
      )
      finishWithError(mapped)
    } finally {
      setStage(SessionStage.CLEANUP, sessionId)
      logInfo(event = "Session cleanup start", sessionId = sessionId, stage = SessionStage.CLEANUP)
      try {
        passportService?.close()
      } catch (_: Throwable) {
      }
      try {
        cardService?.close()
      } catch (_: Throwable) {
      }
      try {
        isoDepForRead?.close()
      } catch (_: Throwable) {
      }
      synchronized(stateLock) {
        if (activeIsoDep === isoDepForRead) {
          activeIsoDep = null
        }
      }
      logInfo(event = "Session cleanup finish", sessionId = sessionId, stage = SessionStage.CLEANUP)
    }
  }

  private fun readPassportPayload(
    passportService: PassportService,
    config: ReadConfig,
    sessionId: String
  ): Map<String, Any?> {
    val accessState = AccessControlState(preferredMethod = config.preferredMethod)
    authenticate(passportService, config, accessState, sessionId)

    val files = LinkedHashMap<String, Any?>()
    var successfulFileCount = 0
    var firstFailure: BridgeError? = null

    for (group in config.requestedGroups) {
      ensureNotCanceled()
      val readStage = stageForDataGroup(group)
      setStage(readStage, sessionId)
      logInfo(
        event = "Reading data group start",
        sessionId = sessionId,
        stage = readStage,
        details = "group=${group.responseKey}"
      )
      try {
        val entry = readDataGroupEntry(passportService, group, config)
        files[group.responseKey] = entry
        if (fileStatus(entry) == FILE_STATUS_OK) {
          successfulFileCount += 1
          setStage(readStage, sessionId, markSuccessfulStep = "READ_${group.responseKey}")
          logInfo(
            event = "Reading data group success",
            sessionId = sessionId,
            stage = readStage,
            details = buildDataGroupLogSummary(group, entry)
          )
        } else if (firstFailure == null) {
          firstFailure = BridgeError(
            code = CODE_PASSPORT_READ_FAILED,
            message = "Failed to read ${group.responseKey}."
          )
          logWarn(
            event = "Reading data group returned non-ok status",
            sessionId = sessionId,
            stage = readStage,
            details = "group=${group.responseKey}; summary=${buildDataGroupLogSummary(group, entry)}"
          )
        }
      } catch (error: Throwable) {
        val mapped = mapError(error)
        if (firstFailure == null) {
          firstFailure = mapped
        }
        files[group.responseKey] = errorFileEntry(group, mapped)
        logError(
          event = "Reading data group failed",
          sessionId = sessionId,
          stage = readStage,
          details = "group=${group.responseKey}; mappedCode=${mapped.code}; errorClass=${error.javaClass.simpleName}; message=${mapped.message}",
          throwable = error
        )
      }
    }

    if (successfulFileCount == 0) {
      throw (firstFailure?.toException() ?: BridgeException(
        CODE_NO_DATA_READ,
        "No readable data groups were retrieved."
      ))
    }

    val payload = buildResultPayload(config, accessState, files)
    logInfo(
      event = "Result payload built",
      sessionId = sessionId,
      stage = SessionStage.COMPLETING,
      details = "finalStatus=${payload["finalStatus"]}; successCount=$successfulFileCount; totalRequested=${config.requestedGroups.size}"
    )
    return payload
  }

  private fun authenticate(
    passportService: PassportService,
    config: ReadConfig,
    accessState: AccessControlState,
    sessionId: String
  ) {
    val attemptOrder = when (config.preferredMethod) {
      AccessControlMethod.BAC ->
        if (config.allowBacFallback) "BAC -> PACE fallback" else "BAC only"

      AccessControlMethod.PACE ->
        if (config.allowBacFallback) "PACE -> BAC fallback" else "PACE only"
    }
    logInfo(
      event = "Authentication started",
      sessionId = sessionId,
      details = "preferred=${config.preferredMethod.rawValue}; allowBacFallback=${config.allowBacFallback}; attemptOrder=$attemptOrder"
    )
    when (config.preferredMethod) {
      AccessControlMethod.BAC -> {
        try {
          doBac(passportService, config, accessState, sessionId)
        } catch (error: Throwable) {
          val mapped = mapError(error)
          accessState.bacStatus = AUTH_STATUS_FAILED
          accessState.accessControlError = mapped.toErrorInfoMap()
          logWarn(
            event = "BAC failed",
            sessionId = sessionId,
            stage = SessionStage.BAC,
            details = "mappedCode=${mapped.code}; message=${mapped.message}; fallbackAllowed=${config.allowBacFallback}"
          )

          if (config.allowBacFallback && shouldFallbackToPace(mapped)) {
            accessState.fallbackUsed = true
            accessState.fallbackReason = "BAC failed; PACE fallback used."
            logInfo(
              event = "Attempting PACE fallback after BAC failure",
              sessionId = sessionId,
              stage = SessionStage.PACE,
              details = "reason=${accessState.fallbackReason}"
            )
            doPace(passportService, config, accessState, sessionId)
            return
          }

          throw mapped.toException()
        }
      }

      AccessControlMethod.PACE -> {
        try {
          doPace(passportService, config, accessState, sessionId)
        } catch (error: Throwable) {
          val mapped = mapError(error)
          accessState.paceStatus = AUTH_STATUS_FAILED
          accessState.accessControlError = mapped.toErrorInfoMap()
          logWarn(
            event = "PACE failed",
            sessionId = sessionId,
            stage = SessionStage.PACE,
            details = "mappedCode=${mapped.code}; message=${mapped.message}; fallbackAllowed=${config.allowBacFallback}"
          )

          if (config.allowBacFallback && shouldFallbackToBac(mapped)) {
            accessState.fallbackUsed = true
            accessState.fallbackReason = "PACE failed or unsupported; BAC fallback used."
            logInfo(
              event = "Attempting BAC fallback after PACE failure",
              sessionId = sessionId,
              stage = SessionStage.BAC,
              details = "reason=${accessState.fallbackReason}"
            )
            doBac(passportService, config, accessState, sessionId)
            return
          }

          throw mapped.toException()
        }
      }
    }
  }

  private fun doPace(
    passportService: PassportService,
    config: ReadConfig,
    accessState: AccessControlState,
    sessionId: String
  ) {
    setStage(SessionStage.PACE, sessionId)
    logInfo(event = "PACE start", sessionId = sessionId, stage = SessionStage.PACE)
    val cardAccessFile = try {
      CardAccessFile(passportService.getInputStream(PassportService.EF_CARD_ACCESS))
    } catch (error: Throwable) {
      logWarn(
        event = "PACE CardAccess read failed",
        sessionId = sessionId,
        stage = SessionStage.PACE,
        details = "errorClass=${error.javaClass.simpleName}; message=${error.message}"
      )
      throw BridgeException(
        CODE_PACE_UNSUPPORTED,
        "PACE did not succeed for this document.",
        error
      )
    }

    val paceInfo = cardAccessFile.securityInfos
      .firstOrNull { it is PACEInfo } as? PACEInfo
    logInfo(
      event = "PACE CardAccess parsed",
      sessionId = sessionId,
      stage = SessionStage.PACE,
      details = buildSecurityInfoSummary(cardAccessFile.securityInfos)
    )

    accessState.paceSupported = paceInfo != null
    if (paceInfo == null) {
      logWarn(event = "PACE unsupported (no PACEInfo)", sessionId = sessionId, stage = SessionStage.PACE)
      throw BridgeException(
        CODE_PACE_UNSUPPORTED,
        "PACE did not succeed for this document."
      )
    }

    try {
      logInfo(
        event = "PACE APDU handshake start",
        sessionId = sessionId,
        stage = SessionStage.PACE,
        details = "objectIdentifier=${paceInfo.objectIdentifier}; parameterId=${paceInfo.parameterId}; protocol=${paceInfo.protocolOIDString}"
      )
      passportService.doPACE(
        config.bacKey,
        paceInfo.objectIdentifier,
        PACEInfo.toParameterSpec(paceInfo.parameterId),
        null
      )
      logInfo(event = "PACE select applet start", sessionId = sessionId, stage = SessionStage.PACE)
      passportService.sendSelectApplet(true)
      accessState.usedMethod = AccessControlMethod.PACE
      accessState.paceStatus = AUTH_STATUS_SUCCESS
      accessState.bacStatus = AUTH_STATUS_NOT_DONE
      setStage(SessionStage.PACE, sessionId, markSuccessfulStep = "PACE_SUCCESS")
      logInfo(event = "PACE success", sessionId = sessionId, stage = SessionStage.PACE)
    } catch (error: Throwable) {
      logWarn(
        event = "PACE failed",
        sessionId = sessionId,
        stage = SessionStage.PACE,
        details = "errorClass=${error.javaClass.simpleName}; message=${error.message}",
        throwable = error
      )
      throw mapError(error).toException()
    }
  }

  private fun doBac(
    passportService: PassportService,
    config: ReadConfig,
    accessState: AccessControlState,
    sessionId: String
  ) {
    setStage(SessionStage.BAC, sessionId)
    logInfo(event = "BAC start", sessionId = sessionId, stage = SessionStage.BAC)
    try {
      logInfo(event = "BAC select applet start", sessionId = sessionId, stage = SessionStage.BAC)
      passportService.sendSelectApplet(false)
      logInfo(event = "BAC APDU handshake start", sessionId = sessionId, stage = SessionStage.BAC)
      passportService.doBAC(config.bacKey)
      accessState.usedMethod = AccessControlMethod.BAC
      accessState.bacStatus = AUTH_STATUS_SUCCESS
      setStage(SessionStage.BAC, sessionId, markSuccessfulStep = "BAC_SUCCESS")
      logInfo(event = "BAC success", sessionId = sessionId, stage = SessionStage.BAC)
    } catch (error: Throwable) {
      accessState.bacStatus = AUTH_STATUS_FAILED
      val mapped = mapError(error)
      logWarn(
        event = "BAC failed",
        sessionId = sessionId,
        stage = SessionStage.BAC,
        details = "mappedCode=${mapped.code}; message=${mapped.message}",
        throwable = error
      )
      if (mapped.code == CODE_INVALID_CREDENTIALS) {
        throw mapped.toException()
      }
      throw BridgeException(
        CODE_BAC_FAILED,
        "BAC authentication failed.",
        mapped.cause ?: error,
        mapped.statusWord
      )
    }
  }

  private fun readDataGroupEntry(
    passportService: PassportService,
    group: RequestedDataGroup,
    config: ReadConfig
  ): Map<String, Any?> {
    return when (group) {
      RequestedDataGroup.DG1 -> readDg1Entry(passportService)
      RequestedDataGroup.DG2 -> readDg2Entry(passportService, config)
      RequestedDataGroup.DG11 -> readDg11Entry(passportService)
      RequestedDataGroup.DG12 -> readDg12Entry(passportService)
      RequestedDataGroup.DG13 -> readDg13Entry(passportService)
      RequestedDataGroup.DG15 -> readDg15Entry(passportService)
      RequestedDataGroup.COM -> readComEntry(passportService)
      RequestedDataGroup.SOD -> readSodEntry(passportService)
      RequestedDataGroup.CARD_ACCESS -> readCardAccessEntry(passportService)
    }
  }

  private fun readDg1Entry(passportService: PassportService): Map<String, Any?> {
    val dg1File = DG1File(passportService.getInputStream(PassportService.EF_DG1))
    val mrzInfo = dg1File.mrzInfo
    val mrz = mrzInfo?.toString().orEmpty()
    val parsed = linkedMapOf<String, Any?>(
      "mrz" to mrz,
      "mrzLines" to splitMrzLines(mrz),
      "documentNumber" to sanitizeMrzDocumentNumber(mrzInfo?.documentNumber),
      "personalNumber" to emptyAsNull(mrzInfo?.personalNumber),
      "issuingAuthority" to emptyAsNull(mrzInfo?.issuingState),
      "dateOfBirth" to emptyAsNull(mrzInfo?.dateOfBirth),
      "documentExpiryDate" to emptyAsNull(mrzInfo?.dateOfExpiry),
      "nationality" to emptyAsNull(mrzInfo?.nationality),
      "gender" to normalizeGenderValue(mrzInfo?.gender?.toString()),
      "firstName" to parseFirstNames(mrzInfo),
      "lastName" to parseLastName(mrzInfo),
      "elements" to linkedMapOf(
        "documentCode" to emptyAsNull(mrzInfo?.documentCode),
        "issuingState" to emptyAsNull(mrzInfo?.issuingState),
        "documentNumber" to sanitizeMrzDocumentNumber(mrzInfo?.documentNumber),
        "nationality" to emptyAsNull(mrzInfo?.nationality)
      )
    )
    return okFileEntry(
      name = RequestedDataGroup.DG1.responseKey,
      rawHex = toHex(dg1File.encoded),
      parsed = parsed
    )
  }

  private fun readDg11Entry(passportService: PassportService): Map<String, Any?> {
    val dg11File = DG11File(passportService.getInputStream(PassportService.EF_DG11))
    val parsed = linkedMapOf<String, Any?>(
      "fullName" to emptyAsNull(dg11File.nameOfHolder),
      "personalNumber" to emptyAsNull(dg11File.personalNumber),
      "dateOfBirth" to emptyAsNull(dg11File.fullDateOfBirth),
      "placeOfBirth" to stringListOrNull(dg11File.placeOfBirth),
      "address" to stringListOrNull(dg11File.permanentAddress),
      "telephone" to emptyAsNull(dg11File.telephone),
      "profession" to emptyAsNull(dg11File.profession),
      "title" to emptyAsNull(dg11File.title),
      "personalSummary" to emptyAsNull(dg11File.personalSummary),
      "proofOfCitizenship" to base64OrNull(dg11File.proofOfCitizenship),
      "tdNumbers" to stringListOrNull(dg11File.otherValidTDNumbers),
      "custodyInfo" to emptyAsNull(dg11File.custodyInformation)
    )
    return okFileEntry(
      name = RequestedDataGroup.DG11.responseKey,
      rawHex = toHex(dg11File.encoded),
      parsed = parsed
    )
  }

  private fun readDg2Entry(
    passportService: PassportService,
    config: ReadConfig
  ): Map<String, Any?> {
    logInfo(
      event = "DG2 image extraction start",
      stage = SessionStage.READING_DG2,
      details = "includeImageBase64=${config.includeImageBase64}; persistDg2ImageFile=${config.persistDg2ImageFile}"
    )
    val dg2File = DG2File(passportService.getInputStream(PassportService.EF_DG2))
    val allFaceImages = dg2File.faceInfos.flatMap { it.faceImageInfos }
    val primaryFace = allFaceImages.firstOrNull()

    val imageBytes = if (primaryFace == null) {
      ByteArray(0)
    } else {
      val dataInputStream = DataInputStream(primaryFace.imageInputStream)
      val byteCount = primaryFace.imageLength
      ByteArray(byteCount).apply {
        dataInputStream.readFully(this, 0, byteCount)
      }
    }

    val imageFormat = detectImageFormat(imageBytes, primaryFace?.mimeType)
    val imageHex = if (imageBytes.isNotEmpty()) toHex(imageBytes) else null
    val imageBase64 = if (config.includeImageBase64 && imageBytes.isNotEmpty()) {
      Base64.encodeToString(imageBytes, Base64.NO_WRAP)
    } else {
      null
    }
    val filePath = if (config.persistDg2ImageFile && imageBytes.isNotEmpty()) {
      persistDg2ImageFile(imageBytes, imageFormat)
    } else {
      null
    }
    logInfo(
      event = "DG2 image extraction result",
      stage = SessionStage.READING_DG2,
      details = "faceImages=${allFaceImages.size}; imageBytes=${imageBytes.size}; format=$imageFormat; filePersisted=${filePath != null}; base64Included=${imageBase64 != null}"
    )

    val parsed = linkedMapOf<String, Any?>(
      "numberOfFacialImages" to allFaceImages.size,
      "imageWidth" to (primaryFace?.width ?: 0),
      "imageHeight" to (primaryFace?.height ?: 0),
      "imageDataType" to (primaryFace?.imageDataType ?: 0),
      "imageByteLength" to imageBytes.size,
      "hasFaceImage" to imageBytes.isNotEmpty(),
      "imageFormat" to imageFormat,
      "imageHex" to imageHex,
      "imageBase64Included" to (config.includeImageBase64 && imageBytes.isNotEmpty()),
      "imageFilePersisted" to (filePath != null),
      "filePath" to filePath,
      "imageBase64" to imageBase64
    )

    val entry = linkedMapOf<String, Any?>(
      "status" to FILE_STATUS_OK,
      "name" to RequestedDataGroup.DG2.responseKey,
      "rawHex" to null,
      "parsed" to parsed,
      "imageFormat" to imageFormat,
      "imageHex" to imageHex,
      "filePath" to filePath,
      "imageBase64" to imageBase64,
      "timestamp" to nowIso()
    )
    return entry
  }

  private fun readDg12Entry(passportService: PassportService): Map<String, Any?> {
    val dg12File = DG12File(passportService.getInputStream(PassportService.EF_DG12))
    val parsed = linkedMapOf<String, Any?>(
      "issuingAuthority" to emptyAsNull(dg12File.issuingAuthority),
      "dateOfIssue" to emptyAsNull(dg12File.dateOfIssue),
      "otherPersonsDetails" to stringListOrNull(dg12File.namesOfOtherPersons),
      "endorsementsOrObservations" to emptyAsNull(dg12File.endorsementsAndObservations),
      "taxOrExitRequirements" to emptyAsNull(dg12File.taxOrExitRequirements),
      "personalizationTime" to emptyAsNull(dg12File.dateAndTimeOfPersonalization),
      "personalizationDeviceSerialNr" to emptyAsNull(dg12File.personalizationSystemSerialNumber),
      "frontImageByteLength" to (dg12File.imageOfFront?.size ?: 0),
      "rearImageByteLength" to (dg12File.imageOfRear?.size ?: 0)
    )
    return okFileEntry(
      name = RequestedDataGroup.DG12.responseKey,
      rawHex = toHex(dg12File.encoded),
      parsed = parsed
    )
  }

  private fun readDg13Entry(passportService: PassportService): Map<String, Any?> {
    val bytes = readAllBytes(passportService.getInputStream(PassportService.EF_DG13))
    val parsed = linkedMapOf<String, Any?>(
      "supportedParser" to false,
      "description" to "DG13 parsed as raw data only in this build.",
      "bodyByteLength" to bytes.size
    )
    return okFileEntry(
      name = RequestedDataGroup.DG13.responseKey,
      rawHex = toHex(bytes),
      parsed = parsed
    )
  }

  private fun readDg15Entry(passportService: PassportService): Map<String, Any?> {
    val dg15File = DG15File(passportService.getInputStream(PassportService.EF_DG15))
    val keyAlgorithm = dg15File.publicKey?.algorithm.orEmpty()
    val parsed = linkedMapOf<String, Any?>(
      "hasRsaPublicKey" to keyAlgorithm.contains("RSA", ignoreCase = true),
      "hasEcdsaPublicKey" to keyAlgorithm.contains("EC", ignoreCase = true),
      "activeAuthenticationSupported" to (dg15File.publicKey != null)
    )
    return okFileEntry(
      name = RequestedDataGroup.DG15.responseKey,
      rawHex = toHex(dg15File.encoded),
      parsed = parsed
    )
  }

  private fun readComEntry(passportService: PassportService): Map<String, Any?> {
    val comFile = COMFile(passportService.getInputStream(PassportService.EF_COM))
    val parsed = linkedMapOf<String, Any?>(
      "ldsVersion" to emptyAsNull(comFile.getLDSVersion()),
      "unicodeVersion" to emptyAsNull(comFile.unicodeVersion),
      "dataGroupsPresent" to comFile.tagList.map { dataGroupNameFromTag(it) ?: String.format(Locale.US, "0x%02X", it) }
    )
    return okFileEntry(
      name = RequestedDataGroup.COM.responseKey,
      rawHex = toHex(comFile.encoded),
      parsed = parsed
    )
  }

  private fun readSodEntry(passportService: PassportService): Map<String, Any?> {
    val sodFile = SODFile(passportService.getInputStream(PassportService.EF_SOD))
    val hashEntries = sodFile.dataGroupHashes.entries
      .sortedBy { it.key }
      .map { entry ->
        linkedMapOf<String, Any?>(
          "id" to entry.key,
          "sodHash" to toHex(entry.value),
          "computedHash" to null,
          "match" to null
        )
      }

    val parsed = linkedMapOf<String, Any?>(
      "hashAlgorithm" to emptyAsNull(sodFile.digestAlgorithm),
      "dgHashes" to hashEntries,
      "passportCorrectlySigned" to null,
      "documentSigningCertificateVerified" to null,
      "passportDataNotTampered" to null,
      "verificationErrors" to emptyList<String>()
    )
    return okFileEntry(
      name = RequestedDataGroup.SOD.responseKey,
      rawHex = toHex(sodFile.encoded),
      parsed = parsed
    )
  }

  private fun readCardAccessEntry(passportService: PassportService): Map<String, Any?> {
    val cardAccessFile = CardAccessFile(passportService.getInputStream(PassportService.EF_CARD_ACCESS))
    val securityInfos = cardAccessFile.securityInfos
    val parsed = linkedMapOf<String, Any?>(
      "paceSupported" to securityInfos.any { it is PACEInfo },
      "securityInfoCount" to securityInfos.size,
      "protocols" to securityInfos.map(SecurityInfo::getProtocolOIDString),
      "objectIdentifiers" to securityInfos.map(SecurityInfo::getObjectIdentifier)
    )
    return okFileEntry(
      name = RequestedDataGroup.CARD_ACCESS.responseKey,
      rawHex = null,
      parsed = parsed
    )
  }

  private fun buildResultPayload(
    config: ReadConfig,
    accessState: AccessControlState,
    files: LinkedHashMap<String, Any?>
  ): Map<String, Any?> {
    val successCount = files.values.count { fileStatus(it) == FILE_STATUS_OK }
    val errorCount = files.values.count { fileStatus(it) == FILE_STATUS_ERROR }
    val finalStatus = when {
      successCount == 0 -> FINAL_STATUS_ERROR
      errorCount == 0 -> FINAL_STATUS_SUCCESS
      else -> FINAL_STATUS_PARTIAL_SUCCESS
    }

    val accessControl = linkedMapOf<String, Any?>(
      "preferred" to accessState.preferredMethod.rawValue,
      "used" to accessState.usedMethod?.rawValue,
      "fallbackUsed" to accessState.fallbackUsed,
      "fallbackReason" to accessState.fallbackReason,
      "paceStatus" to accessState.paceStatus,
      "bacStatus" to accessState.bacStatus,
      "paceSupported" to accessState.paceSupported,
      "error" to accessState.accessControlError
    )

    val metadata = linkedMapOf<String, Any?>(
      "paceStatus" to accessState.paceStatus,
      "bacStatus" to accessState.bacStatus,
      "paceSupported" to accessState.paceSupported,
      "timestamp" to nowIso(),
      "fallbackReason" to accessState.fallbackReason
    )

    return linkedMapOf<String, Any?>(
      "accessControl" to accessControl,
      "files" to files,
      "finalStatus" to finalStatus,
      "success" to (finalStatus != FINAL_STATUS_ERROR),
      "method" to accessState.usedMethod?.rawValue,
      "preferredAccessControl" to config.preferredMethod.rawValue,
      "fallbackUsed" to accessState.fallbackUsed,
      "metadata" to metadata,
      "data" to extractOkData(files)
    )
  }

  private fun extractOkData(files: Map<String, Any?>): Map<String, Any?> {
    val data = LinkedHashMap<String, Any?>()
    for ((key, value) in files) {
      if (value !is Map<*, *>) {
        continue
      }
      val status = value["status"] as? String ?: continue
      if (status != FILE_STATUS_OK) {
        continue
      }

      val payload = LinkedHashMap<String, Any?>()
      for ((entryKey, entryValue) in value) {
        val keyString = entryKey as? String ?: continue
        if (keyString == "status") {
          continue
        }
        payload[keyString] = entryValue
      }
      data[key] = payload
    }
    return data
  }

  private fun okFileEntry(
    name: String,
    rawHex: String?,
    parsed: Map<String, Any?>
  ): Map<String, Any?> {
    return linkedMapOf<String, Any?>(
      "status" to FILE_STATUS_OK,
      "name" to name,
      "rawHex" to rawHex,
      "parsed" to parsed,
      "timestamp" to nowIso()
    )
  }

  private fun errorFileEntry(
    group: RequestedDataGroup,
    error: BridgeError
  ): Map<String, Any?> {
    return linkedMapOf<String, Any?>(
      "status" to FILE_STATUS_ERROR,
      "name" to group.responseKey,
      "reason" to error.message,
      "error" to error.toErrorInfoMap(),
      "timestamp" to nowIso()
    )
  }

  private fun fileStatus(entry: Any?): String {
    if (entry !is Map<*, *>) {
      return FILE_STATUS_ERROR
    }
    val status = entry["status"] as? String ?: return FILE_STATUS_ERROR
    return status
  }

  private fun cancelActiveRead() {
    val snapshot = synchronized(stateLock) {
      val currentPromise = pendingPromise ?: return@synchronized null
      val snapshot = SessionSnapshot(
        promise = currentPromise,
        activity = pendingActivity,
        adapter = pendingAdapter,
        timeoutRunnable = pendingTimeoutRunnable,
        activeIsoDep = activeIsoDep,
        debug = pendingSessionDebug
      )

      pendingPromise = null
      pendingConfig = null
      pendingActivity = null
      pendingAdapter = null
      pendingTimeoutRunnable = null
      pendingSessionDebug = null
      hasHandledTag = false
      cancelRequested = true
      activeIsoDep = null
      snapshot
    } ?: return

    logWarn(
      event = "Active session canceled",
      sessionId = snapshot.debug?.sessionId,
      stage = SessionStage.CLEANUP,
      elapsedMs = snapshot.debug?.let { SystemClock.elapsedRealtime() - it.startElapsedMs },
      details = "lastSuccessfulStep=${snapshot.debug?.lastSuccessfulStep ?: "none"}"
    )
    cleanupSession(snapshot)
    snapshot.promise.reject(CODE_USER_CANCELED, "User canceled NFC session.")
  }

  private fun finishWithSuccess(result: Map<String, Any?>) {
    val snapshot = takeSessionSnapshot()
    if (snapshot == null) {
      logWarn(event = "finishWithSuccess ignored because session already completed")
      return
    }
    logInfo(
      event = "Resolving passport NFC promise",
      sessionId = snapshot.debug?.sessionId,
      stage = SessionStage.COMPLETING,
      elapsedMs = snapshot.debug?.let { SystemClock.elapsedRealtime() - it.startElapsedMs },
      details = "finalStatus=${result["finalStatus"]}; lastSuccessfulStep=${snapshot.debug?.lastSuccessfulStep ?: "none"}"
    )
    cleanupSession(snapshot)
    snapshot.promise.resolve(Arguments.makeNativeMap(result))
  }

  private fun finishWithError(error: BridgeError) {
    val snapshot = takeSessionSnapshot()
    if (snapshot == null) {
      logWarn(
        event = "finishWithError ignored because session already completed",
        details = "code=${error.code}; message=${error.message}"
      )
      return
    }
    logWarn(
      event = "Rejecting passport NFC promise",
      sessionId = snapshot.debug?.sessionId,
      elapsedMs = snapshot.debug?.let { SystemClock.elapsedRealtime() - it.startElapsedMs },
      details = "code=${error.code}; stageAtFailure=${snapshot.debug?.stage ?: "none"}; lastSuccessfulStep=${snapshot.debug?.lastSuccessfulStep ?: "none"}; message=${error.message}"
    )
    cleanupSession(snapshot)
    rejectBridgeError(snapshot.promise, error)
  }

  private fun rejectBridgeError(promise: Promise, error: BridgeError) {
    if (error.cause != null) {
      promise.reject(error.code, error.message, error.cause)
    } else {
      promise.reject(error.code, error.message)
    }
  }

  private fun takeSessionSnapshot(): SessionSnapshot? {
    return synchronized(stateLock) {
      val promise = pendingPromise ?: return@synchronized null
      val snapshot = SessionSnapshot(
        promise = promise,
        activity = pendingActivity,
        adapter = pendingAdapter,
        timeoutRunnable = pendingTimeoutRunnable,
        activeIsoDep = activeIsoDep,
        debug = pendingSessionDebug
      )

      pendingPromise = null
      pendingConfig = null
      pendingActivity = null
      pendingAdapter = null
      pendingTimeoutRunnable = null
      pendingSessionDebug = null
      hasHandledTag = false
      cancelRequested = false
      activeIsoDep = null
      snapshot
    }
  }

  private fun cleanupSession(snapshot: SessionSnapshot) {
    logInfo(
      event = "Cleanup session start",
      sessionId = snapshot.debug?.sessionId,
      stage = SessionStage.CLEANUP
    )
    snapshot.timeoutRunnable?.let { mainHandler.removeCallbacks(it) }

    mainHandler.post {
      val adapter = snapshot.adapter
      val activity = snapshot.activity
      if (adapter != null && activity != null && !activity.isFinishing) {
        try {
          adapter.disableReaderMode(activity)
          logInfo(
            event = "Reader mode disabled",
            sessionId = snapshot.debug?.sessionId,
            stage = SessionStage.CLEANUP
          )
        } catch (_: Throwable) {
          logWarn(
            event = "Failed to disable reader mode cleanly",
            sessionId = snapshot.debug?.sessionId,
            stage = SessionStage.CLEANUP
          )
        }
      }
    }

    try {
      snapshot.activeIsoDep?.close()
      if (snapshot.activeIsoDep != null) {
        logInfo(
          event = "IsoDep closed during cleanup",
          sessionId = snapshot.debug?.sessionId,
          stage = SessionStage.CLEANUP
        )
      }
    } catch (_: Throwable) {
      logWarn(
        event = "IsoDep close failed during cleanup",
        sessionId = snapshot.debug?.sessionId,
        stage = SessionStage.CLEANUP
      )
    }
    logInfo(
      event = "Cleanup session finish",
      sessionId = snapshot.debug?.sessionId,
      stage = SessionStage.CLEANUP
    )
  }

  private fun ensureNotCanceled() {
    val canceled = synchronized(stateLock) { cancelRequested }
    if (canceled) {
      throw BridgeException(CODE_USER_CANCELED, "User canceled NFC session.")
    }
  }

  private fun setStage(
    stage: SessionStage,
    sessionId: String? = null,
    markSuccessfulStep: String? = null
  ) {
    var statusToEmit: PassportScanStatus? = null
    var emitSessionId: String? = sessionId
    synchronized(stateLock) {
      val debug = pendingSessionDebug ?: return
      if (sessionId != null && debug.sessionId != sessionId) {
        return
      }
      debug.stage = stage
      if (!markSuccessfulStep.isNullOrBlank()) {
        debug.lastSuccessfulStep = markSuccessfulStep
      }
      val status = passportScanStatusForStage(stage)
      if (status != null && debug.lastEmittedScanStatus != status) {
        debug.lastEmittedScanStatus = status
        statusToEmit = status
        emitSessionId = debug.sessionId
      }
    }

    if (statusToEmit != null) {
      emitPassportScanStatus(statusToEmit, stage, emitSessionId)
    }
  }

  private fun captureDebugSnapshot(): SessionDebugSnapshot {
    return synchronized(stateLock) {
      val debug = pendingSessionDebug
      if (debug == null) {
        SessionDebugSnapshot(
          sessionId = null,
          stage = SessionStage.IDLE,
          elapsedMs = null,
          lastSuccessfulStep = null
        )
      } else {
        SessionDebugSnapshot(
          sessionId = debug.sessionId,
          stage = debug.stage,
          elapsedMs = SystemClock.elapsedRealtime() - debug.startElapsedMs,
          lastSuccessfulStep = debug.lastSuccessfulStep
        )
      }
    }
  }

  private fun logStage(
    stage: SessionStage,
    sessionId: String? = null,
    details: String? = null,
    markSuccessfulStep: String? = null
  ) {
    setStage(stage, sessionId, markSuccessfulStep)
    logInfo(
      event = "Stage -> ${stage.rawValue}",
      sessionId = sessionId,
      stage = stage,
      details = details
    )
  }

  private fun passportScanStatusForStage(stage: SessionStage): PassportScanStatus? {
    return when (stage) {
      SessionStage.WAITING_FOR_TAG -> PassportScanStatus.WAITING_FOR_TAG
      SessionStage.TAG_DISCOVERED,
      SessionStage.ISODEP_CONNECTING,
      SessionStage.ISODEP_CONNECTED -> PassportScanStatus.FOUND_TAG
      SessionStage.PACE,
      SessionStage.BAC -> PassportScanStatus.AUTHORIZING_TAG
      SessionStage.READING_DG1,
      SessionStage.READING_DG2,
      SessionStage.READING_DG11,
      SessionStage.READING_DG12,
      SessionStage.READING_DG13,
      SessionStage.READING_DG15,
      SessionStage.READING_COM,
      SessionStage.READING_SOD,
      SessionStage.READING_CARD_ACCESS -> PassportScanStatus.READING_TAG
      SessionStage.IDLE,
      SessionStage.COMPLETING,
      SessionStage.CLEANUP -> null
    }
  }

  private fun emitPassportScanStatus(
    status: PassportScanStatus?,
    stage: SessionStage,
    sessionId: String?
  ) {
    if (status == null) {
      return
    }

    val payload = Arguments.createMap().apply {
      putString("status", status.rawValue)
      putString("message", status.message)
      putString("platform", "android")
      putString("stage", stage.rawValue)
      if (!sessionId.isNullOrBlank()) {
        putString("sessionId", sessionId)
      }
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }

    mainHandler.post {
      try {
        reactApplicationContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(SCAN_STATUS_EVENT_NAME, payload)
      } catch (error: Throwable) {
        logWarn(
          event = "Failed to emit scan status event",
          sessionId = sessionId,
          stage = stage,
          details = "status=${status.rawValue}; errorClass=${error.javaClass.simpleName}; message=${error.message}"
        )
      }
    }
  }

  private fun logInfo(
    event: String,
    sessionId: String? = null,
    stage: SessionStage? = null,
    elapsedMs: Long? = null,
    details: String? = null
  ) {
    logWithLevel(
      level = LogLevel.INFO,
      event = event,
      sessionId = sessionId,
      stage = stage,
      elapsedMs = elapsedMs,
      details = details
    )
  }

  private fun logWarn(
    event: String,
    sessionId: String? = null,
    stage: SessionStage? = null,
    elapsedMs: Long? = null,
    details: String? = null,
    throwable: Throwable? = null
  ) {
    logWithLevel(
      level = LogLevel.WARN,
      event = event,
      sessionId = sessionId,
      stage = stage,
      elapsedMs = elapsedMs,
      details = details,
      throwable = throwable
    )
  }

  private fun logError(
    event: String,
    sessionId: String? = null,
    stage: SessionStage? = null,
    elapsedMs: Long? = null,
    details: String? = null,
    throwable: Throwable? = null
  ) {
    logWithLevel(
      level = LogLevel.ERROR,
      event = event,
      sessionId = sessionId,
      stage = stage,
      elapsedMs = elapsedMs,
      details = details,
      throwable = throwable
    )
  }

  private fun logWithLevel(
    level: LogLevel,
    event: String,
    sessionId: String?,
    stage: SessionStage?,
    elapsedMs: Long?,
    details: String?,
    throwable: Throwable? = null
  ) {
    if (!BuildConfig.DEBUG) {
      return
    }

    val parts = mutableListOf("event=$event")
    if (!sessionId.isNullOrBlank()) {
      parts.add("sessionId=$sessionId")
    }
    if (stage != null) {
      parts.add("stage=${stage.rawValue}")
    }
    if (elapsedMs != null) {
      parts.add("elapsedMs=$elapsedMs")
    }
    if (!details.isNullOrBlank()) {
      parts.add(details)
    }
    val message = truncateForLog(parts.joinToString("; "))

    when (level) {
      LogLevel.INFO -> {
        if (throwable != null) {
          Log.i(LOG_TAG, message, throwable)
        } else {
          Log.i(LOG_TAG, message)
        }
      }
      LogLevel.WARN -> {
        if (throwable != null) {
          Log.w(LOG_TAG, message, throwable)
        } else {
          Log.w(LOG_TAG, message)
        }
      }
      LogLevel.ERROR -> {
        if (throwable != null) {
          Log.e(LOG_TAG, message, throwable)
        } else {
          Log.e(LOG_TAG, message)
        }
      }
    }
  }

  private fun buildTagDiagnostics(tag: Tag?, isoDep: IsoDep? = tag?.let { IsoDep.get(it) }): String {
    if (tag == null) {
      return "tag=null"
    }

    return listOf(
      "tagId=${toHexPreview(tag.id) ?: "unknown"}",
      "techList=[${tag.techList.joinToString(", ")}]",
      "hasIsoDep=${isoDep != null}",
      "isoDep={${buildIsoDepDiagnostics(isoDep)}}"
    ).joinToString("; ")
  }

  private fun buildIsoDepDiagnostics(isoDep: IsoDep?): String {
    if (isoDep == null) {
      return "null"
    }

    return try {
      listOf(
        "isConnected=${isoDep.isConnected}",
        "timeoutMs=${isoDep.timeout}",
        "maxTransceiveLength=${isoDep.maxTransceiveLength}",
        "extendedLength=${isoDep.isExtendedLengthApduSupported}",
        "historicalBytes=${toHexPreview(isoDep.historicalBytes)}",
        "hiLayerResponse=${toHexPreview(isoDep.hiLayerResponse)}"
      ).joinToString("; ")
    } catch (error: Throwable) {
      "diagnosticsFailed=${error.javaClass.simpleName}:${error.message}"
    }
  }

  private fun buildReadPassportInputSummary(input: ReadableMap): String {
    val credentialSource = when {
      input.hasKey("credentials") && !input.isNull("credentials") -> "nestedCredentials"
      else -> "flatInput"
    }
    val hasDataGroups = input.hasKey("dataGroups") && !input.isNull("dataGroups")
    val hasPreferred = input.hasKey("preferredAccessControl") && !input.isNull("preferredAccessControl")
    val hasMrzKey = when {
      input.hasKey("credentials") && !input.isNull("credentials") &&
        input.getType("credentials") == ReadableType.Map -> {
        val credentials = input.getMap("credentials")
        credentials?.hasKey("mrzKey") == true || credentials?.hasKey("MRZKey") == true
      }

      else -> input.hasKey("mrzKey") || input.hasKey("MRZKey")
    }
    val hasDocFields = when {
      input.hasKey("credentials") && !input.isNull("credentials") &&
        input.getType("credentials") == ReadableType.Map -> {
        val credentials = input.getMap("credentials")
        credentials?.hasKey("documentNumber") == true &&
          credentials.hasKey("dateOfBirth") &&
          credentials.hasKey("dateOfExpiry")
      }

      else ->
        input.hasKey("documentNumber") &&
          input.hasKey("dateOfBirth") &&
          input.hasKey("dateOfExpiry")
    }
    return "source=$credentialSource; hasDataGroups=$hasDataGroups; hasPreferred=$hasPreferred; hasMrzKey=$hasMrzKey; hasDocumentFields=$hasDocFields"
  }

  private fun buildConfigSummaryForLog(config: ReadConfig): String {
    return "preferred=${config.preferredMethod.rawValue}; allowBacFallback=${config.allowBacFallback}; requestedGroups=${config.requestedGroups.map { it.responseKey }}; includeImageBase64=${config.includeImageBase64}; persistDg2ImageFile=${config.persistDg2ImageFile}; mrzKeyLength=${config.mrzKey.length}"
  }

  private fun stageForDataGroup(group: RequestedDataGroup): SessionStage {
    return when (group) {
      RequestedDataGroup.DG1 -> SessionStage.READING_DG1
      RequestedDataGroup.DG2 -> SessionStage.READING_DG2
      RequestedDataGroup.DG11 -> SessionStage.READING_DG11
      RequestedDataGroup.DG12 -> SessionStage.READING_DG12
      RequestedDataGroup.DG13 -> SessionStage.READING_DG13
      RequestedDataGroup.DG15 -> SessionStage.READING_DG15
      RequestedDataGroup.COM -> SessionStage.READING_COM
      RequestedDataGroup.SOD -> SessionStage.READING_SOD
      RequestedDataGroup.CARD_ACCESS -> SessionStage.READING_CARD_ACCESS
    }
  }

  private fun buildDataGroupLogSummary(
    group: RequestedDataGroup,
    entry: Map<String, Any?>
  ): String {
    val status = fileStatus(entry)
    val rawHex = entry["rawHex"] as? String
    val rawByteLength = rawHex?.length?.let { it / 2 }
    val error = entry["error"] as? Map<*, *>
    val errorCode = error?.get("code")
    val statusWord = error?.get("statusWord")
    if (group != RequestedDataGroup.DG2) {
      val parsed = entry["parsed"] as? Map<*, *>
      return "group=${group.responseKey}; status=$status; rawByteLength=${rawByteLength ?: "none"}; parsedKeys=${parsed?.keys?.joinToString(",") ?: "none"}; errorCode=${errorCode ?: "none"}; statusWord=${statusWord ?: "none"}"
    }

    val parsed = entry["parsed"] as? Map<*, *>
    val imageByteLength = parsed?.get("imageByteLength")
    val format = parsed?.get("imageFormat")
    val hasFaceImage = parsed?.get("hasFaceImage")
    return "group=${group.responseKey}; status=$status; rawByteLength=${rawByteLength ?: "none"}; imageByteLength=$imageByteLength; imageFormat=$format; hasFaceImage=$hasFaceImage; errorCode=${errorCode ?: "none"}; statusWord=${statusWord ?: "none"}"
  }

  private fun buildSecurityInfoSummary(securityInfos: Collection<SecurityInfo>): String {
    val protocols = securityInfos
      .map { info ->
        val paceSuffix = if (info is PACEInfo) {
          ":parameterId=${info.parameterId}"
        } else {
          ""
        }
        "${info.javaClass.simpleName}:oid=${info.objectIdentifier}:protocol=${info.protocolOIDString}$paceSuffix"
      }
    return "securityInfoCount=${securityInfos.size}; securityInfos=[${protocols.joinToString(" | ")}]"
  }

  private fun generateSessionId(): String {
    return UUID.randomUUID()
      .toString()
      .replace("-", "")
      .take(8)
  }

  private fun parseReadConfig(input: ReadableMap): ReadConfig {
    val credentialsMap = if (input.hasKey("credentials") && !input.isNull("credentials")) {
      if (input.getType("credentials") != ReadableType.Map) {
        throw BridgeException(
          CODE_INVALID_INPUT,
          "credentials must be an object when provided."
        )
      }
      input.getMap("credentials")
        ?: throw BridgeException(CODE_INVALID_INPUT, "credentials must be an object.")
    } else {
      input
    }

    val preferredMethodValue = getString(input, "preferredAccessControl") ?: "BAC"
    val preferredMethod = AccessControlMethod.fromRaw(preferredMethodValue)
    val allowBacFallback = getBoolean(input, "allowBacFallback", true)
    val includeImageBase64 = getBoolean(input, "includeImageBase64", false)
    val persistDg2ImageFile = when {
      hasNonNullKey(input, "persistDg2ImageFile") -> getBoolean(input, "persistDg2ImageFile", false)
      hasNonNullKey(input, "persistImageFile") -> getBoolean(input, "persistImageFile", false)
      else -> false
    }
    val requestedGroups = parseRequestedGroups(input)

    val mrzKeyInput = getString(credentialsMap, "mrzKey")
      ?: getString(credentialsMap, "MRZKey")
    val documentNumberInput = getString(credentialsMap, "documentNumber")
    val dateOfBirthInput = getString(credentialsMap, "dateOfBirth")
    val dateOfExpiryInput = getString(credentialsMap, "dateOfExpiry")

    val normalizedFromMrz = mrzKeyInput?.let { parseMrzKeyOrThrow(it) }
    val documentNumber = sanitizeMrzDocumentNumber(
      documentNumberInput ?: normalizedFromMrz?.documentNumber
    )
    val dateOfBirth = normalizeMrzDate(dateOfBirthInput ?: normalizedFromMrz?.dateOfBirth)
    val dateOfExpiry = normalizeMrzDate(dateOfExpiryInput ?: normalizedFromMrz?.dateOfExpiry)

    if (documentNumber.isNullOrEmpty() || dateOfBirth == null || dateOfExpiry == null) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "Missing credentials. Provide credentials.mrzKey or credentials.documentNumber/dateOfBirth/dateOfExpiry."
      )
    }

    if (!MRZ_DOCUMENT_NUMBER_REGEX.matches(documentNumber)) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "credentials.documentNumber must contain 1 to 9 MRZ-safe alphanumeric characters."
      )
    }
    if (!MRZ_DATE_REGEX.matches(dateOfBirth)) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "credentials.dateOfBirth must be a 6-digit YYMMDD value."
      )
    }
    if (!MRZ_DATE_REGEX.matches(dateOfExpiry)) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "credentials.dateOfExpiry must be a 6-digit YYMMDD value."
      )
    }

    if (normalizedFromMrz != null) {
      if (normalizedFromMrz.documentNumber != documentNumber ||
        normalizedFromMrz.dateOfBirth != dateOfBirth ||
        normalizedFromMrz.dateOfExpiry != dateOfExpiry
      ) {
        throw BridgeException(
          CODE_INVALID_INPUT,
          "Provided MRZ key does not match the supplied passport fields."
        )
      }
    }

    val bacKey: BACKeySpec = BACKey(documentNumber, dateOfBirth, dateOfExpiry)
    val mrzKey = normalizedFromMrz?.mrzKey
      ?: buildMrzKey(documentNumber, dateOfBirth, dateOfExpiry)

    return ReadConfig(
      mrzKey = mrzKey,
      bacKey = bacKey,
      preferredMethod = preferredMethod,
      allowBacFallback = allowBacFallback,
      includeImageBase64 = includeImageBase64,
      persistDg2ImageFile = persistDg2ImageFile,
      requestedGroups = requestedGroups
    )
  }

  private fun parseRequestedGroups(input: ReadableMap): List<RequestedDataGroup> {
    if (!input.hasKey("dataGroups") || input.isNull("dataGroups")) {
      return DEFAULT_REQUESTED_GROUPS
    }

    if (input.getType("dataGroups") != ReadableType.Array) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "dataGroups must be a non-empty array of strings."
      )
    }

    val array = input.getArray("dataGroups")
      ?: throw BridgeException(
        CODE_INVALID_INPUT,
        "dataGroups must be a non-empty array of strings."
      )
    if (array.size() <= 0) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "dataGroups must be a non-empty array of strings."
      )
    }

    val result = mutableListOf<RequestedDataGroup>()
    for (index in 0 until array.size()) {
      if (array.getType(index) != ReadableType.String) {
        throw BridgeException(
          CODE_INVALID_INPUT,
          "dataGroups must be a non-empty array of strings."
        )
      }

      val rawName = array.getString(index).orEmpty()
      val group = RequestedDataGroup.fromInput(rawName)
        ?: throw BridgeException(
          CODE_INVALID_INPUT,
          "Unsupported data group '$rawName'."
        )

      if (!result.contains(group)) {
        result.add(group)
      }
    }

    return result
  }

  private fun parseMrzKeyOrThrow(rawValue: String): ParsedMrzKey {
    val normalized = rawValue
      .trim()
      .uppercase(Locale.US)
      .replace("\\s+".toRegex(), "")

    if (!MRZ_KEY_REGEX.matches(normalized)) {
      throw BridgeException(
        CODE_INVALID_INPUT,
        "credentials.mrzKey must be 24 MRZ-safe characters."
      )
    }

    val documentNumberMrz = normalized.substring(0, 9)
    val documentNumberCheck = normalized[9]
    val dateOfBirth = normalized.substring(10, 16)
    val dateOfBirthCheck = normalized[16]
    val dateOfExpiry = normalized.substring(17, 23)
    val dateOfExpiryCheck = normalized[23]

    if (calculateMrzCheckDigit(documentNumberMrz) != documentNumberCheck) {
      throw BridgeException(CODE_INVALID_INPUT, "Invalid document number check digit in MRZ key.")
    }
    if (calculateMrzCheckDigit(dateOfBirth) != dateOfBirthCheck) {
      throw BridgeException(CODE_INVALID_INPUT, "Invalid date of birth check digit in MRZ key.")
    }
    if (calculateMrzCheckDigit(dateOfExpiry) != dateOfExpiryCheck) {
      throw BridgeException(CODE_INVALID_INPUT, "Invalid date of expiry check digit in MRZ key.")
    }

    return ParsedMrzKey(
      mrzKey = normalized,
      documentNumber = sanitizeMrzDocumentNumber(documentNumberMrz).orEmpty(),
      dateOfBirth = dateOfBirth,
      dateOfExpiry = dateOfExpiry
    )
  }

  private fun buildMrzKey(
    documentNumber: String,
    dateOfBirth: String,
    dateOfExpiry: String
  ): String {
    val documentNumberMrz = documentNumber.padEnd(9, '<')
    val documentNumberCheck = calculateMrzCheckDigit(documentNumberMrz)
    val dateOfBirthCheck = calculateMrzCheckDigit(dateOfBirth)
    val dateOfExpiryCheck = calculateMrzCheckDigit(dateOfExpiry)
    return "$documentNumberMrz$documentNumberCheck$dateOfBirth$dateOfBirthCheck$dateOfExpiry$dateOfExpiryCheck"
  }

  private fun calculateMrzCheckDigit(value: String): Char {
    val normalized = value.uppercase(Locale.US)
    var total = 0
    for (index in normalized.indices) {
      val char = normalized[index]
      val charValue = when {
        char in '0'..'9' -> char - '0'
        char in 'A'..'Z' -> char.code - 'A'.code + 10
        char == '<' -> 0
        else -> 0
      }
      total += charValue * CHECK_DIGIT_WEIGHTS[index % CHECK_DIGIT_WEIGHTS.size]
    }
    return ('0'.code + (total % 10)).toChar()
  }

  private fun mapError(error: Throwable): BridgeError {
    if (error is BridgeException) {
      return error.toBridgeError()
    }

    if (error is TagLostException) {
      return BridgeError(
        code = CODE_NFC_SESSION_INVALIDATED,
        message = "NFC connection lost while reading passport.",
        cause = error
      )
    }

    if (error is BACDeniedException) {
      return BridgeError(
        code = CODE_INVALID_CREDENTIALS,
        message = "Provided MRZ key is invalid.",
        cause = error,
        statusWord = formatStatusWord(error.getSW())
      )
    }

    if (error is PACEException) {
      return BridgeError(
        code = CODE_PACE_FAILED,
        message = error.message ?: "PACE authentication failed.",
        cause = error,
        statusWord = formatStatusWord(error.getSW())
      )
    }

    if (error is CardServiceException) {
      val sw = error.getSW()
      if (sw == 0x6982) {
        return BridgeError(
          code = CODE_SECURITY_STATUS_NOT_SATISFIED,
          message = "Security status not satisfied (SW=${formatStatusWord(sw)}).",
          cause = error,
          statusWord = formatStatusWord(sw)
        )
      }
      if (sw == 0x6A82) {
        return BridgeError(
          code = CODE_FILE_NOT_FOUND,
          message = "Requested file not found (SW=${formatStatusWord(sw)}).",
          cause = error,
          statusWord = formatStatusWord(sw)
        )
      }
      if (sw > 0) {
        return BridgeError(
          code = CODE_APDU_RESPONSE_ERROR,
          message = "${error.message ?: "Passport chip communication failed."} (SW=${formatStatusWord(sw)}).",
          cause = error,
          statusWord = formatStatusWord(sw)
        )
      }
      return BridgeError(
        code = CODE_PASSPORT_READ_FAILED,
        message = error.message ?: "Passport NFC reading failed.",
        cause = error
      )
    }

    if (isCancelError(error)) {
      return BridgeError(
        code = CODE_USER_CANCELED,
        message = "User canceled NFC session.",
        cause = error
      )
    }

    return BridgeError(
      code = CODE_UNKNOWN_ERROR,
      message = error.message ?: "Unknown passport NFC error.",
      cause = error
    )
  }

  private fun shouldFallbackToBac(error: BridgeError): Boolean {
    return when (error.code) {
      CODE_PACE_UNSUPPORTED,
      CODE_PACE_FAILED,
      CODE_SECURITY_STATUS_NOT_SATISFIED -> true

      CODE_APDU_RESPONSE_ERROR ->
        error.message.contains("pace", ignoreCase = true)

      else -> false
    }
  }

  private fun shouldFallbackToPace(error: BridgeError): Boolean {
    return when (error.code) {
      CODE_INVALID_CREDENTIALS -> false
      CODE_USER_CANCELED,
      CODE_NFC_TIMEOUT,
      CODE_NFC_SESSION_INVALIDATED -> false

      else -> true
    }
  }

  private fun isCancelError(error: Throwable): Boolean {
    if (error is BridgeException && error.code == CODE_USER_CANCELED) {
      return true
    }
    val canceled = synchronized(stateLock) { cancelRequested }
    return canceled
  }

  private fun formatStatusWord(sw: Int): String {
    return String.format(Locale.US, "%04X", sw and 0xFFFF)
  }

  private fun detectImageFormat(bytes: ByteArray, mimeType: String?): String {
    val mime = mimeType?.lowercase(Locale.US)
    if (!mime.isNullOrBlank()) {
      return when {
        mime.contains("jpeg2000") || mime.contains("jp2") -> "jpeg2000"
        mime.contains("jpeg") || mime.contains("jpg") -> "jpeg"
        mime.contains("wsq") -> "wsq"
        else -> mime
      }
    }

    if (bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte()) {
      return "jpeg"
    }

    val jp2Header = byteArrayOf(
      0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A
    )
    if (bytes.size >= jp2Header.size && bytes.copyOfRange(0, jp2Header.size).contentEquals(jp2Header)) {
      return "jpeg2000"
    }

    val j2kCodestreamHeader = byteArrayOf(
      0xFF.toByte(), 0x4F, 0xFF.toByte(), 0x51
    )
    if (bytes.size >= j2kCodestreamHeader.size &&
      bytes.copyOfRange(0, j2kCodestreamHeader.size).contentEquals(j2kCodestreamHeader)
    ) {
      return "jpeg2000"
    }

    if (bytes.isEmpty()) {
      return "none"
    }

    return "unknown"
  }

  private fun persistDg2ImageFile(bytes: ByteArray, format: String): String? {
    if (bytes.isEmpty()) {
      return null
    }

    val extension = when (format) {
      "jpeg" -> "jpg"
      "jpeg2000" -> "jp2"
      "wsq" -> "wsq"
      else -> "bin"
    }
    val fileName = "passport_dg2_${UUID.randomUUID()}.$extension"
    val file = reactApplicationContext.cacheDir.resolve(fileName)

    return try {
      file.writeBytes(bytes)
      cleanupGeneratedDg2Files(keepPath = file.absolutePath)
      file.absolutePath
    } catch (_: Throwable) {
      null
    }
  }

  private fun cleanupGeneratedDg2Files(keepPath: String? = null) {
    val directory = reactApplicationContext.cacheDir ?: return
    val files = directory.listFiles() ?: return
    for (file in files) {
      if (!file.name.startsWith("passport_dg2_")) {
        continue
      }
      if (keepPath != null && file.absolutePath == keepPath) {
        continue
      }
      try {
        file.delete()
      } catch (_: Throwable) {
      }
    }
  }

  private fun splitMrzLines(mrz: String?): List<String> {
    if (mrz.isNullOrBlank()) {
      return emptyList()
    }

    if (mrz.contains("\n")) {
      return mrz
        .split("\n")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
    }

    val normalized = mrz.trim()
    if (normalized.length == 88) {
      return listOf(normalized.substring(0, 44), normalized.substring(44))
    }
    if (normalized.length == 90) {
      return listOf(
        normalized.substring(0, 30),
        normalized.substring(30, 60),
        normalized.substring(60)
      )
    }

    return listOf(normalized)
  }

  private fun parseFirstNames(mrzInfo: MRZInfo?): String? {
    if (mrzInfo == null) {
      return null
    }
    val secondary = mrzInfo.secondaryIdentifierComponents?.toList().orEmpty()
      .map { stripMrzFillers(it) }
      .filter { !it.isNullOrEmpty() }
      .joinToString(" ")
      .trim()
    return emptyAsNull(secondary)
  }

  private fun parseLastName(mrzInfo: MRZInfo?): String? {
    return emptyAsNull(stripMrzFillers(mrzInfo?.primaryIdentifier))
  }

  private fun stripMrzFillers(value: String?): String? {
    return value
      ?.replace("<", " ")
      ?.trim()
      ?.replace("\\s+".toRegex(), " ")
  }

  private fun normalizeGenderValue(value: String?): String? {
    val normalized = value?.trim().orEmpty()
    if (normalized.isEmpty()) {
      return null
    }
    if (normalized == "<") {
      return null
    }
    return normalized
  }

  private fun sanitizeMrzDocumentNumber(value: String?): String? {
    val normalized = value
      ?.trim()
      ?.uppercase(Locale.US)
      ?: return null
    if (normalized.isEmpty()) {
      return null
    }
    return normalized.replace("<", "")
  }

  private fun normalizeMrzDate(value: String?): String? {
    val digits = value
      ?.trim()
      ?.replace("\\D".toRegex(), "")
      ?: return null
    return if (digits.length == 6) digits else null
  }

  private fun emptyAsNull(value: String?): String? {
    val trimmed = value?.trim()
    return if (trimmed.isNullOrEmpty()) null else trimmed
  }

  private fun stringListOrNull(values: List<String>?): List<String>? {
    if (values.isNullOrEmpty()) {
      return null
    }
    val normalized = values
      .mapNotNull { emptyAsNull(it) }
    return if (normalized.isEmpty()) null else normalized
  }

  private fun base64OrNull(bytes: ByteArray?): String? {
    if (bytes == null || bytes.isEmpty()) {
      return null
    }
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  private fun getString(map: ReadableMap, key: String): String? {
    if (!map.hasKey(key) || map.isNull(key)) {
      return null
    }
    if (map.getType(key) != ReadableType.String) {
      throw BridgeException(CODE_INVALID_INPUT, "$key must be a string.")
    }
    return map.getString(key)
  }

  private fun getBoolean(map: ReadableMap, key: String, fallback: Boolean): Boolean {
    if (!map.hasKey(key) || map.isNull(key)) {
      return fallback
    }
    if (map.getType(key) != ReadableType.Boolean) {
      throw BridgeException(CODE_INVALID_INPUT, "$key must be a boolean.")
    }
    return map.getBoolean(key)
  }

  private fun hasNonNullKey(map: ReadableMap, key: String): Boolean {
    return map.hasKey(key) && !map.isNull(key)
  }

  private fun readAllBytes(inputStream: InputStream): ByteArray {
    inputStream.use { stream ->
      val buffer = ByteArrayOutputStream()
      val data = ByteArray(4096)
      while (true) {
        val read = stream.read(data)
        if (read <= 0) {
          break
        }
        buffer.write(data, 0, read)
      }
      return buffer.toByteArray()
    }
  }

  private fun nowIso(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date())
  }

  private fun dataGroupNameFromTag(tag: Int): String? {
    return when (tag) {
      0x61 -> "DG1"
      0x75 -> "DG2"
      0x6B -> "DG11"
      0x6C -> "DG12"
      0x6D -> "DG13"
      0x6F -> "DG15"
      0x60 -> "COM"
      0x77 -> "SOD"
      else -> null
    }
  }

  private fun truncateForLog(value: String, maxChars: Int = MAX_LOG_MESSAGE_CHARS): String {
    if (value.length <= maxChars) {
      return value
    }
    return value.take(maxChars) + "...<truncated:${value.length - maxChars}>"
  }

  private fun toHexPreview(bytes: ByteArray?, maxBytes: Int = MAX_LOG_HEX_PREVIEW_BYTES): String? {
    if (bytes == null || bytes.isEmpty()) {
      return null
    }

    val previewBytes = if (bytes.size > maxBytes) bytes.copyOfRange(0, maxBytes) else bytes
    val suffix = if (bytes.size > maxBytes) "...(${bytes.size} bytes)" else "(${bytes.size} bytes)"
    return "${toHex(previewBytes)}$suffix"
  }

  private fun toHex(bytes: ByteArray?): String? {
    if (bytes == null || bytes.isEmpty()) {
      return null
    }
    val chars = CharArray(bytes.size * 2)
    val hexAlphabet = "0123456789ABCDEF".toCharArray()
    for (i in bytes.indices) {
      val value = bytes[i].toInt() and 0xFF
      chars[i * 2] = hexAlphabet[value ushr 4]
      chars[i * 2 + 1] = hexAlphabet[value and 0x0F]
    }
    return String(chars)
  }

  override fun initialize() {
    super.initialize()
    ensureBouncyCastleProvider()
    val provider = Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)
    logInfo(
      event = "Native module initialized",
      details = "debug=${BuildConfig.DEBUG}; bouncyCastleProvider=${provider?.javaClass?.name ?: "missing"}; providerPosition=${Security.getProviders().indexOf(provider)}"
    )
  }

  private fun ensureBouncyCastleProvider() {
    val current = Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)
    if (current == null || current.javaClass != BouncyCastleProvider::class.java) {
      Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
      Security.insertProviderAt(BouncyCastleProvider(), 1)
    }
  }

  private data class ParsedMrzKey(
    val mrzKey: String,
    val documentNumber: String,
    val dateOfBirth: String,
    val dateOfExpiry: String
  )

  private data class ReadConfig(
    val mrzKey: String,
    val bacKey: BACKeySpec,
    val preferredMethod: AccessControlMethod,
    val allowBacFallback: Boolean,
    val includeImageBase64: Boolean,
    val persistDg2ImageFile: Boolean,
    val requestedGroups: List<RequestedDataGroup>
  )

  private data class ReaderSessionContext(
    val config: ReadConfig,
    val sessionId: String
  )

  private data class SessionDebugState(
    val sessionId: String,
    val startElapsedMs: Long,
    var stage: SessionStage,
    var lastSuccessfulStep: String? = null,
    var lastEmittedScanStatus: PassportScanStatus? = null
  )

  private data class SessionDebugSnapshot(
    val sessionId: String?,
    val stage: SessionStage,
    val elapsedMs: Long?,
    val lastSuccessfulStep: String?
  )

  private data class SessionSnapshot(
    val promise: Promise,
    val activity: Activity?,
    val adapter: NfcAdapter?,
    val timeoutRunnable: Runnable?,
    val activeIsoDep: IsoDep?,
    val debug: SessionDebugState?
  )

  private data class AccessControlState(
    val preferredMethod: AccessControlMethod,
    var usedMethod: AccessControlMethod? = null,
    var fallbackUsed: Boolean = false,
    var fallbackReason: String? = null,
    var paceStatus: String = AUTH_STATUS_NOT_DONE,
    var bacStatus: String = AUTH_STATUS_NOT_DONE,
    var paceSupported: Boolean = false,
    var accessControlError: Map<String, Any?>? = null
  )

  private data class BridgeError(
    val code: String,
    val message: String,
    val cause: Throwable? = null,
    val statusWord: String? = null
  ) {
    fun toException(): BridgeException {
      return BridgeException(code, message, cause, statusWord)
    }

    fun toErrorInfoMap(): Map<String, Any?> {
      val map = linkedMapOf<String, Any?>(
        "code" to code,
        "message" to message
      )
      if (!statusWord.isNullOrEmpty()) {
        map["statusWord"] = statusWord
      }
      return map
    }
  }

  private class BridgeException(
    val code: String,
    override val message: String,
    cause: Throwable? = null,
    val statusWord: String? = null
  ) : Exception(message, cause) {
    fun toBridgeError(): BridgeError {
      return BridgeError(code = code, message = message, cause = cause, statusWord = statusWord)
    }
  }

  private enum class SessionStage(val rawValue: String) {
    IDLE("IDLE"),
    WAITING_FOR_TAG("WAITING_FOR_TAG"),
    TAG_DISCOVERED("TAG_DISCOVERED"),
    ISODEP_CONNECTING("ISODEP_CONNECTING"),
    ISODEP_CONNECTED("ISODEP_CONNECTED"),
    PACE("PACE"),
    BAC("BAC"),
    READING_DG1("READING_DG1"),
    READING_DG2("READING_DG2"),
    READING_DG11("READING_DG11"),
    READING_DG12("READING_DG12"),
    READING_DG13("READING_DG13"),
    READING_DG15("READING_DG15"),
    READING_COM("READING_COM"),
    READING_SOD("READING_SOD"),
    READING_CARD_ACCESS("READING_CARD_ACCESS"),
    COMPLETING("COMPLETING"),
    CLEANUP("CLEANUP")
  }

  private enum class LogLevel {
    INFO,
    WARN,
    ERROR
  }

  private enum class PassportScanStatus(val rawValue: String, val message: String) {
    WAITING_FOR_TAG("waiting_for_tag", "Waiting for tag"),
    FOUND_TAG("found_tag", "Found tag"),
    AUTHORIZING_TAG("authorizing_tag", "Authorizing tag"),
    READING_TAG("reading_tag", "Reading tag")
  }

  private enum class AccessControlMethod(val rawValue: String) {
    PACE("PACE"),
    BAC("BAC");

    companion object {
      fun fromRaw(raw: String): AccessControlMethod {
        return if (raw.trim().uppercase(Locale.US) == "BAC") {
          BAC
        } else {
          PACE
        }
      }
    }
  }

  private enum class RequestedDataGroup(val responseKey: String) {
    DG1("DG1"),
    DG2("DG2"),
    DG11("DG11"),
    DG12("DG12"),
    DG13("DG13"),
    DG15("DG15"),
    COM("COM"),
    SOD("SOD"),
    CARD_ACCESS("CardAccess");

    companion object {
      fun fromInput(name: String): RequestedDataGroup? {
        return when (name.trim().uppercase(Locale.US)) {
          "DG1" -> DG1
          "DG2" -> DG2
          "DG11" -> DG11
          "DG12" -> DG12
          "DG13" -> DG13
          "DG15" -> DG15
          "COM" -> COM
          "SOD" -> SOD
          "CARDACCESS" -> CARD_ACCESS
          else -> null
        }
      }
    }
  }

  companion object {
    private const val LOG_TAG = "PassportVerificationModule"
    private const val SCAN_STATUS_EVENT_NAME = "PassportVerificationScanStatus"

    private const val FILE_STATUS_OK = "ok"
    private const val FILE_STATUS_ERROR = "error"

    private const val FINAL_STATUS_SUCCESS = "success"
    private const val FINAL_STATUS_PARTIAL_SUCCESS = "partial_success"
    private const val FINAL_STATUS_ERROR = "error"

    private const val AUTH_STATUS_NOT_DONE = "notDone"
    private const val AUTH_STATUS_SUCCESS = "success"
    private const val AUTH_STATUS_FAILED = "failed"

    private const val CODE_INVALID_INPUT = "INVALID_INPUT"
    private const val CODE_NFC_SESSION_BUSY = "NFC_SESSION_BUSY"
    private const val CODE_USER_CANCELED = "USER_CANCELED"
    private const val CODE_NFC_TIMEOUT = "NFC_TIMEOUT"
    private const val CODE_NFC_SESSION_INVALIDATED = "NFC_SESSION_INVALIDATED"
    private const val CODE_INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    private const val CODE_PACE_UNSUPPORTED = "PACE_UNSUPPORTED"
    private const val CODE_PACE_FAILED = "PACE_FAILED"
    private const val CODE_BAC_FAILED = "BAC_FAILED"
    private const val CODE_NO_DATA_READ = "NO_DATA_READ"
    private const val CODE_NON_ISO7816_TAG = "NON_ISO7816_TAG"
    private const val CODE_SECURITY_STATUS_NOT_SATISFIED = "SECURITY_STATUS_NOT_SATISFIED"
    private const val CODE_FILE_NOT_FOUND = "FILE_NOT_FOUND"
    private const val CODE_APDU_RESPONSE_ERROR = "APDU_RESPONSE_ERROR"
    private const val CODE_PASSPORT_READ_FAILED = "PASSPORT_READ_FAILED"
    private const val CODE_UNKNOWN_ERROR = "UNKNOWN_ERROR"

    private const val SESSION_TIMEOUT_MS = 75_000L
    private const val ISO_DEP_TIMEOUT_MS = 10_000
    private const val MAX_LOG_MESSAGE_CHARS = 2_000
    private const val MAX_LOG_HEX_PREVIEW_BYTES = 32

    private val DEFAULT_REQUESTED_GROUPS = listOf(
      RequestedDataGroup.COM,
      RequestedDataGroup.SOD,
      RequestedDataGroup.DG1,
      RequestedDataGroup.DG2,
      RequestedDataGroup.DG11,
      RequestedDataGroup.DG12,
      RequestedDataGroup.DG13,
      RequestedDataGroup.DG15,
      RequestedDataGroup.CARD_ACCESS
    )

    private val CHECK_DIGIT_WEIGHTS = intArrayOf(7, 3, 1)
    private val MRZ_DATE_REGEX = Regex("^\\d{6}$")
    private val MRZ_DOCUMENT_NUMBER_REGEX = Regex("^[A-Z0-9]{1,9}$")
    private val MRZ_KEY_REGEX = Regex("^[A-Z0-9<]{24}$")
  }
}
