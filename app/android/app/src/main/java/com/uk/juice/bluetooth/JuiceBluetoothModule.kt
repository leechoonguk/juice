package com.uk.juice.bluetooth

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import com.uk.juice.MainActivity
import java.util.concurrent.ConcurrentHashMap

/**
 * What `mobile/src/juiceBattery.ts` reads: the bonded Bluetooth devices, which
 * of them are connected, and each one's battery level. Android has no public
 * call for another device's battery; `BluetoothDevice.isConnected()` and
 * `getBatteryLevel()` are hidden, so they are reached by reflection and a
 * device whose call fails simply has no level. When `isConnected()` cannot be
 * called, the public profile proxies and GATT list who is connected. The system
 * also broadcasts `BATTERY_LEVEL_CHANGED` while a device is connected; the last
 * level seen per address is kept and fills in where the direct call gives nothing.
 */
class JuiceBluetoothModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private var receiver: BroadcastReceiver? = null
  private var closed = false
  private val proxies = ConcurrentHashMap<Int, BluetoothProfile>()
  private val requested: MutableSet<Int> = ConcurrentHashMap.newKeySet()
  private val proxyListener =
      object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
          if (closed) {
            runCatching { adapter()?.closeProfileProxy(profile, proxy) }
          } else {
            proxies[profile] = proxy
          }
        }

        override fun onServiceDisconnected(profile: Int) {
          proxies.remove(profile)
          requested.remove(profile)
        }
      }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    val registered =
        object : BroadcastReceiver() {
          override fun onReceive(received: Context, intent: Intent) {
            onBroadcast(intent)
          }
        }
    val filter =
        IntentFilter().apply {
          addAction(ACTION_BATTERY_LEVEL_CHANGED)
          addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
          addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }
    // Exported: the Bluetooth stack sends these from its own uid; all three are protected broadcasts, so no app can spoof them.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(registered, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(registered, filter)
    }
    receiver = registered
    openProxies()
  }

  override fun invalidate() {
    receiver?.let { runCatching { context.unregisterReceiver(it) } }
    receiver = null
    closed = true
    closeProxies()
    super.invalidate()
  }

  /** Every bonded device with its class, connection state and level (null when unknown). */
  @ReactMethod
  fun connectedDevices(promise: Promise) {
    if (!canConnect()) {
      promise.reject(PERMISSION_ERROR, "Bluetooth permission has not been granted")
      return
    }
    try {
      val adapter = adapter()
      val bonded = if (adapter == null || !adapter.isEnabled) emptySet() else adapter.bondedDevices
      val devices = Arguments.createArray()
      val fallback = lazy { publiclyConnected() }
      for (device in bonded) {
        devices.pushMap(describe(device, fallback))
      }
      promise.resolve(devices)
    } catch (error: SecurityException) {
      promise.reject(PERMISSION_ERROR, error.message, error)
    } catch (error: Exception) {
      promise.reject("E_BLUETOOTH", error.message, error)
    }
  }

  /** Shows a low-battery notification on the `low-battery` channel; opening it opens the app. */
  @ReactMethod
  fun notify(id: String, title: String, body: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Low battery", NotificationManager.IMPORTANCE_HIGH))
      }
      val launch =
          Intent(context, MainActivity::class.java)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
      val builder =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.Notification.Builder(context, CHANNEL_ID)
          } else {
            @Suppress("DEPRECATION") android.app.Notification.Builder(context)
          }
      manager.notify(
          id.hashCode(),
          builder
              .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
              .setContentTitle(title)
              .setContentText(body)
              .setContentIntent(open)
              .setAutoCancel(true)
              .build())
    } catch (error: SecurityException) {
      // Without the notification permission the system drops the alert; nothing else to do.
    }
  }

  /** Required by `NativeEventEmitter`; the receiver runs for the module's whole life. */
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  private fun adapter(): BluetoothAdapter? =
      (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter

  private fun canConnect(): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
          context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
              PackageManager.PERMISSION_GRANTED

  private fun describe(device: BluetoothDevice, fallback: Lazy<Set<String>>): WritableMap {
    val connected = hiddenInt(device, "isConnected") ?: if (fallback.value.contains(device.address)) 1 else 0
    val reflected = hiddenInt(device, "getBatteryLevel")?.takeIf { it in 0..100 }
    val level = if (connected == 1) reflected ?: levels[device.address] else null
    val map = Arguments.createMap()
    map.putString("name", nameOf(device))
    map.putString("address", device.address)
    val deviceClass = device.bluetoothClass?.deviceClass
    if (deviceClass == null) map.putNull("deviceClass") else map.putInt("deviceClass", deviceClass)
    if (level == null) map.putNull("level") else map.putInt("level", level)
    map.putBoolean("connected", connected == 1)
    return map
  }

  /**
   * Who is connected by public APIs only, for when the hidden `isConnected()` cannot be called:
   * what the profile proxies and GATT report now, plus the connections seen since the app started.
   */
  private fun publiclyConnected(): Set<String> {
    openProxies()
    val found = HashSet<String>()
    for (proxy in proxies.values) {
      runCatching { proxy.connectedDevices.forEach { found.add(it.address) } }
    }
    runCatching {
      (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
          .getConnectedDevices(BluetoothProfile.GATT)
          .forEach { found.add(it.address) }
    }
    found.addAll(seenConnected)
    return found
  }

  /**
   * Asks for the profile proxies that list connected audio and input devices. They connect
   * asynchronously, so a read made before they have uses the ones that have; each is asked for once.
   */
  private fun openProxies() {
    if (!canConnect()) {
      return
    }
    val adapter = adapter() ?: return
    for (profile in PROXY_PROFILES) {
      if (requested.add(profile)) {
        val asked = runCatching { adapter.getProfileProxy(context, proxyListener, profile) }.getOrDefault(false)
        if (!asked) {
          requested.remove(profile)
        }
      }
    }
  }

  private fun closeProxies() {
    val adapter = adapter()
    for ((profile, proxy) in proxies) {
      runCatching { adapter?.closeProfileProxy(profile, proxy) }
    }
    proxies.clear()
    requested.clear()
  }

  private fun nameOf(device: BluetoothDevice): String {
    val alias = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) device.alias else null
    return alias ?: device.name ?: device.address
  }

  private fun onBroadcast(intent: Intent) {
    val device = intent.deviceExtra() ?: return
    val address = device.address ?: return
    val event = Arguments.createMap()
    event.putString("address", address)
    when (intent.action) {
      ACTION_BATTERY_LEVEL_CHANGED -> {
        val level = intent.getIntExtra(EXTRA_BATTERY_LEVEL, -1)
        if (level in 0..100) {
          levels[address] = level
          event.putInt("level", level)
        } else {
          levels.remove(address)
          event.putNull("level")
        }
      }
      BluetoothDevice.ACTION_ACL_CONNECTED -> {
        seenConnected.add(address)
        event.putNull("level")
      }
      else -> {
        seenConnected.remove(address)
        levels.remove(address)
        event.putNull("level")
      }
    }
    if (context.hasActiveReactInstance()) {
      context.getJSModule(RCTDeviceEventEmitter::class.java).emit(EVENT, event)
    }
  }

  private fun Intent.deviceExtra(): BluetoothDevice? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
      } else {
        @Suppress("DEPRECATION") getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
      }

  /** A hidden `BluetoothDevice` call as an int (a boolean as 0 or 1), or null when it cannot be made. */
  private fun hiddenInt(device: BluetoothDevice, method: String): Int? =
      try {
        when (val value = BluetoothDevice::class.java.getMethod(method).invoke(device)) {
          is Int -> value
          is Boolean -> if (value) 1 else 0
          else -> null
        }
      } catch (error: Throwable) {
        null
      }

  companion object {
    const val NAME = "JuiceBluetooth"
    const val EVENT = "JuiceBluetoothChanged"
    const val CHANNEL_ID = "low-battery"
    const val PERMISSION_ERROR = "E_PERMISSION"
    private const val ACTION_BATTERY_LEVEL_CHANGED =
        "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED"
    private const val EXTRA_BATTERY_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL"

    /** A2DP, HEADSET and the hidden-constant INPUT_DEVICE (4), which lists keyboards and mice. */
    private val PROXY_PROFILES = listOf(BluetoothProfile.A2DP, BluetoothProfile.HEADSET, 4)

    private val levels = ConcurrentHashMap<String, Int>()
    private val seenConnected: MutableSet<String> = ConcurrentHashMap.newKeySet()
  }
}
