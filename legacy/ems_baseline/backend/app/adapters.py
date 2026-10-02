from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import math
from typing import Any
from urllib.parse import parse_qs, urlparse

from .mapping_profiles import resolve_adapter_config
from .models import AdapterConfig


class AdapterError(Exception):
    """Raised when an adapter cannot connect, read or write."""


class AdapterPlugin(ABC):
    """Common plugin contract for HIL/SIL protocol adapters."""

    @abstractmethod
    def connect(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def read(self) -> dict[str, float | int | bool | str]:
        raise NotImplementedError

    @abstractmethod
    def write(self, setpoints: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def clock_sync(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def watchdog_write(self, ts_ms: int) -> None:
        raise NotImplementedError

    @abstractmethod
    def watchdog_health(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def shutdown(self) -> None:
        raise NotImplementedError


def _parse_endpoint(endpoint: str, default_scheme: str, default_port: int) -> tuple[str, int, str]:
    raw = endpoint.strip()
    if "://" not in raw:
        raw = f"{default_scheme}://{raw}"

    parsed = urlparse(raw)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or default_port
    normalized = f"{parsed.scheme or default_scheme}://{host}:{port}"
    return host, port, normalized


def _is_simulated(config: AdapterConfig) -> bool:
    if config.transport == "sim":
        return True
    endpoint = (config.endpoint or "").strip().lower()
    if endpoint.startswith("sim://"):
        return True
    if config.transport == "auto" and not endpoint:
        return True
    return False


def _parse_watchdog_fault_endpoint(endpoint: str) -> tuple[bool, int, str]:
    raw = (endpoint or "").strip()
    if not raw:
        return False, 0, "always"

    parsed = urlparse(raw)
    target = (parsed.netloc or parsed.path.lstrip("/")).strip().lower()
    if parsed.scheme != "sim" or target != "fault-watchdog":
        return False, 0, "always"

    query = parse_qs(parsed.query, keep_blank_values=False)
    after_successes_raw = query.get("after_successes", ["0"])[0]
    mode = query.get("mode", ["always"])[0].strip().lower()

    try:
        after_successes = max(0, int(after_successes_raw))
    except ValueError:
        after_successes = 0

    if mode not in {"once", "always"}:
        mode = "always"

    return True, after_successes, mode


def _register_spec(spec: str) -> tuple[int, float]:
    raw = spec.strip()
    if "@" in raw:
        register_str, scale_str = raw.split("@", 1)
        scale = float(scale_str)
    else:
        register_str = raw
        scale = 1.0

    register = int(register_str)
    # Accept both native address (0-based) and holding register notation (40001-based).
    address = register - 40001 if register >= 40001 else register
    return max(0, address), scale if scale != 0 else 1.0


def _coerce_numeric(value: Any) -> float:
    def _ensure_finite(number: float) -> float:
        if math.isnan(number) or math.isinf(number):
            raise ValueError(f"Numeric value cannot be NaN or Infinity: {value!r}")
        return number

    if isinstance(value, bool):
        return _ensure_finite(1.0 if value else 0.0)
    if isinstance(value, (int, float)):
        return _ensure_finite(float(value))
    if isinstance(value, str):
        lv = value.strip().lower()
        if lv in {"true", "on", "1"}:
            return _ensure_finite(1.0)
        if lv in {"false", "off", "0"}:
            return _ensure_finite(0.0)
        return _ensure_finite(float(value))
    raise ValueError(f"Unsupported numeric value: {value!r}")


def _coerce_payload(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    return str(value)


@dataclass
class SimulatedAdapter(AdapterPlugin):
    config: AdapterConfig
    protocol: str
    connected: bool = False
    last_setpoints: dict[str, Any] = field(default_factory=dict)
    watchdog_state: bool = False
    watchdog_last_ts_ms: int = 0

    def connect(self) -> None:
        self.connected = True

    def read(self) -> dict[str, float | int | bool | str]:
        return {
            **self.last_setpoints,
            "connected": self.connected,
            "endpoint": self.config.endpoint,
            "protocol": self.protocol,
        }

    def write(self, setpoints: dict[str, Any]) -> None:
        self.last_setpoints = dict(setpoints)

    def health(self) -> dict[str, Any]:
        return {
            "adapter": self.protocol,
            "connected": self.connected,
            "endpoint": self.config.endpoint,
            "mapped_signals": len(self.config.mapping),
            "transport": "sim",
        }

    def clock_sync(self) -> dict[str, Any]:
        return {
            "adapter": self.protocol,
            "clock_state": "synchronized",
            "offset_ms": 0.0,
        }

    def shutdown(self) -> None:
        self.connected = False

    def watchdog_write(self, ts_ms: int) -> None:
        if not self.config.watchdog_enabled:
            return
        self.watchdog_state = not self.watchdog_state
        self.watchdog_last_ts_ms = ts_ms

    def watchdog_health(self) -> dict[str, Any]:
        return {
            "enabled": self.config.watchdog_enabled,
            "signal": self.config.watchdog_signal,
            "last_ts_ms": self.watchdog_last_ts_ms,
            "state": self.watchdog_state,
        }


@dataclass
class FaultWatchdogSimulatedAdapter(SimulatedAdapter):
    after_successes: int = 0
    mode: str = "always"
    watchdog_attempts: int = 0
    watchdog_failures: int = 0
    _once_injected: bool = False

    def watchdog_write(self, ts_ms: int) -> None:
        if not self.config.watchdog_enabled:
            super().watchdog_write(ts_ms)
            return

        self.watchdog_attempts += 1
        should_fail = self.watchdog_attempts > self.after_successes
        if self.mode == "once":
            should_fail = should_fail and not self._once_injected

        if should_fail:
            self.watchdog_failures += 1
            self._once_injected = True
            raise AdapterError(f"injected_watchdog_failure:{self.config.name}:{self.watchdog_attempts}")

        super().watchdog_write(ts_ms)

    def watchdog_health(self) -> dict[str, Any]:
        health = super().watchdog_health()
        health.update(
            {
                "fault_injection": {
                    "enabled": True,
                    "after_successes": self.after_successes,
                    "mode": self.mode,
                    "attempts": self.watchdog_attempts,
                    "failures": self.watchdog_failures,
                }
            }
        )
        return health


class ModbusAdapter(AdapterPlugin):
    def __init__(self, config: AdapterConfig) -> None:
        self.config = config
        self.connected = False
        self._client: Any = None
        self._host = ""
        self._port = 0
        self._watchdog_state = 0
        self._watchdog_last_ts_ms = 0

    def connect(self) -> None:
        try:
            from pymodbus.client import ModbusTcpClient
        except Exception as exc:  # pragma: no cover - depends on optional package
            raise AdapterError(
                "pymodbus is not installed; install optional dependency to enable live Modbus adapter"
            ) from exc

        self._host, self._port, _ = _parse_endpoint(self.config.endpoint, "tcp", 502)
        self._client = ModbusTcpClient(self._host, port=self._port, timeout=self.config.timeout_ms / 1000.0)

        if not self._client.connect():
            raise AdapterError(f"Modbus connect failed: {self._host}:{self._port}")
        self.connected = True

    def read(self) -> dict[str, float | int | bool | str]:
        if not self.connected or not self._client:
            raise AdapterError("Modbus adapter is not connected")

        values: dict[str, float | int | bool | str] = {}
        for signal, spec in self.config.mapping.items():
            address, scale = _register_spec(spec)
            result = self._client.read_holding_registers(address=address, count=1)
            if hasattr(result, "isError") and result.isError():
                continue

            registers = getattr(result, "registers", [])
            if not registers:
                continue

            decoded = float(registers[0]) / scale
            values[signal] = bool(round(decoded)) if signal.endswith("_on") else decoded

        return values

    def write(self, setpoints: dict[str, Any]) -> None:
        if not self.connected or not self._client:
            raise AdapterError("Modbus adapter is not connected")

        for signal, spec in self.config.mapping.items():
            if signal not in setpoints:
                continue

            address, scale = _register_spec(spec)
            raw = int(round(_coerce_numeric(setpoints[signal]) * scale))
            result = self._client.write_register(address=address, value=raw)
            if hasattr(result, "isError") and result.isError():
                raise AdapterError(f"Modbus write failed for signal '{signal}' at address {address}")

    def health(self) -> dict[str, Any]:
        return {
            "adapter": "modbus",
            "connected": self.connected,
            "endpoint": f"{self._host}:{self._port}" if self.connected else self.config.endpoint,
            "mapped_signals": len(self.config.mapping),
            "transport": "live",
        }

    def clock_sync(self) -> dict[str, Any]:
        return {
            "adapter": "modbus",
            "clock_state": "n/a",
            "offset_ms": 0.0,
        }

    def shutdown(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
        self.connected = False

    def watchdog_write(self, ts_ms: int) -> None:
        if not self.config.watchdog_enabled:
            return
        if not self.connected or not self._client:
            raise AdapterError("Modbus adapter is not connected")
        if not self.config.watchdog_signal:
            raise AdapterError("Missing watchdog_signal for Modbus adapter")

        address, scale = _register_spec(self.config.watchdog_signal)
        self._watchdog_state = 0 if self._watchdog_state else 1
        raw = int(round(self._watchdog_state * scale))
        result = self._client.write_register(address=address, value=raw)
        if hasattr(result, "isError") and result.isError():
            raise AdapterError(f"Modbus watchdog write failed at address {address}")
        self._watchdog_last_ts_ms = ts_ms

    def watchdog_health(self) -> dict[str, Any]:
        return {
            "enabled": self.config.watchdog_enabled,
            "signal": self.config.watchdog_signal,
            "last_ts_ms": self._watchdog_last_ts_ms,
            "state": bool(self._watchdog_state),
        }


class OpcUaAdapter(AdapterPlugin):
    def __init__(self, config: AdapterConfig) -> None:
        self.config = config
        self.connected = False
        self._client: Any = None
        self._watchdog_state = False
        self._watchdog_last_ts_ms = 0

    def connect(self) -> None:
        try:
            from opcua import Client
        except Exception as exc:  # pragma: no cover - depends on optional package
            raise AdapterError(
                "opcua is not installed; install optional dependency to enable live OPC UA adapter"
            ) from exc

        endpoint = self.config.endpoint.strip()
        if not endpoint:
            raise AdapterError("OPC UA endpoint is required in live mode")
        if not endpoint.startswith("opc.tcp://"):
            endpoint = f"opc.tcp://{endpoint}"

        self._client = Client(endpoint, timeout=self.config.timeout_ms / 1000.0)
        self._client.connect()
        self.connected = True

    def read(self) -> dict[str, float | int | bool | str]:
        if not self.connected or self._client is None:
            raise AdapterError("OPC UA adapter is not connected")

        values: dict[str, float | int | bool | str] = {}
        for signal, node_id in self.config.mapping.items():
            node = self._client.get_node(node_id)
            values[signal] = node.get_value()
        return values

    def write(self, setpoints: dict[str, Any]) -> None:
        if not self.connected or self._client is None:
            raise AdapterError("OPC UA adapter is not connected")

        for signal, node_id in self.config.mapping.items():
            if signal not in setpoints:
                continue
            node = self._client.get_node(node_id)
            node.set_value(setpoints[signal])

    def health(self) -> dict[str, Any]:
        return {
            "adapter": "opcua",
            "connected": self.connected,
            "endpoint": self.config.endpoint,
            "mapped_signals": len(self.config.mapping),
            "transport": "live",
        }

    def clock_sync(self) -> dict[str, Any]:
        return {
            "adapter": "opcua",
            "clock_state": "synchronized",
            "offset_ms": 0.0,
        }

    def shutdown(self) -> None:
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
        self.connected = False

    def watchdog_write(self, ts_ms: int) -> None:
        if not self.config.watchdog_enabled:
            return
        if not self.connected or self._client is None:
            raise AdapterError("OPC UA adapter is not connected")
        if not self.config.watchdog_signal:
            raise AdapterError("Missing watchdog_signal for OPC UA adapter")

        self._watchdog_state = not self._watchdog_state
        node = self._client.get_node(self.config.watchdog_signal)
        node.set_value(self._watchdog_state)
        self._watchdog_last_ts_ms = ts_ms

    def watchdog_health(self) -> dict[str, Any]:
        return {
            "enabled": self.config.watchdog_enabled,
            "signal": self.config.watchdog_signal,
            "last_ts_ms": self._watchdog_last_ts_ms,
            "state": self._watchdog_state,
        }


class MqttAdapter(AdapterPlugin):
    def __init__(self, config: AdapterConfig) -> None:
        self.config = config
        self.connected = False
        self._client: Any = None
        self._last_values: dict[str, float | int | bool | str] = {}
        self._topic_to_signal = {topic: signal for signal, topic in self.config.mapping.items()}
        self._watchdog_state = False
        self._watchdog_last_ts_ms = 0

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt
        except Exception as exc:  # pragma: no cover - depends on optional package
            raise AdapterError(
                "paho-mqtt is not installed; install optional dependency to enable live MQTT adapter"
            ) from exc

        host, port, _ = _parse_endpoint(self.config.endpoint or "mqtt://127.0.0.1:1883", "mqtt", 1883)

        def on_connect(client: Any, _userdata: Any, _flags: Any, rc: int, _properties: Any = None) -> None:
            if rc == 0:
                for topic in self._topic_to_signal:
                    client.subscribe(topic)

        def on_message(_client: Any, _userdata: Any, message: Any) -> None:
            signal = self._topic_to_signal.get(message.topic)
            if not signal:
                return
            raw = message.payload.decode("utf-8", errors="ignore")
            try:
                if raw.lower() in {"true", "false"}:
                    self._last_values[signal] = raw.lower() == "true"
                else:
                    self._last_values[signal] = float(raw)
            except Exception:
                self._last_values[signal] = raw

        self._client = mqtt.Client()
        self._client.on_connect = on_connect
        self._client.on_message = on_message
        self._client.connect(host, port, keepalive=max(5, self.config.timeout_ms // 1000))
        self._client.loop_start()
        self.connected = True

    def read(self) -> dict[str, float | int | bool | str]:
        return dict(self._last_values)

    def write(self, setpoints: dict[str, Any]) -> None:
        if not self.connected or self._client is None:
            raise AdapterError("MQTT adapter is not connected")

        for signal, topic in self.config.mapping.items():
            if signal not in setpoints:
                continue
            self._client.publish(topic, _coerce_payload(setpoints[signal]), qos=1, retain=False)

    def health(self) -> dict[str, Any]:
        return {
            "adapter": "mqtt",
            "connected": self.connected,
            "endpoint": self.config.endpoint,
            "mapped_signals": len(self.config.mapping),
            "transport": "live",
        }

    def clock_sync(self) -> dict[str, Any]:
        return {
            "adapter": "mqtt",
            "clock_state": "n/a",
            "offset_ms": 0.0,
        }

    def shutdown(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
        self.connected = False

    def watchdog_write(self, ts_ms: int) -> None:
        if not self.config.watchdog_enabled:
            return
        if not self.connected or self._client is None:
            raise AdapterError("MQTT adapter is not connected")
        if not self.config.watchdog_signal:
            raise AdapterError("Missing watchdog_signal for MQTT adapter")

        self._watchdog_state = not self._watchdog_state
        self._client.publish(self.config.watchdog_signal, _coerce_payload(self._watchdog_state), qos=1, retain=False)
        self._watchdog_last_ts_ms = ts_ms

    def watchdog_health(self) -> dict[str, Any]:
        return {
            "enabled": self.config.watchdog_enabled,
            "signal": self.config.watchdog_signal,
            "last_ts_ms": self._watchdog_last_ts_ms,
            "state": self._watchdog_state,
        }


def build_adapters(configs: list[AdapterConfig]) -> list[AdapterPlugin]:
    adapters: list[AdapterPlugin] = []
    for raw_cfg in configs:
        if not raw_cfg.enabled:
            continue

        cfg = resolve_adapter_config(raw_cfg)

        if _is_simulated(cfg):
            inject_fault, after_successes, mode = _parse_watchdog_fault_endpoint(cfg.endpoint)
            if inject_fault:
                adapters.append(
                    FaultWatchdogSimulatedAdapter(
                        config=cfg,
                        protocol=cfg.name,
                        after_successes=after_successes,
                        mode=mode,
                    )
                )
            else:
                adapters.append(SimulatedAdapter(config=cfg, protocol=cfg.name))
            continue

        if cfg.name == "modbus":
            adapters.append(ModbusAdapter(cfg))
        elif cfg.name == "mqtt":
            adapters.append(MqttAdapter(cfg))
        elif cfg.name == "opcua":
            adapters.append(OpcUaAdapter(cfg))

    return adapters
