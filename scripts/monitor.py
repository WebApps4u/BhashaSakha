#!/usr/bin/env python3
"""BhashaSakha System Monitor — Real-time health dashboard.

Displays live system metrics including CPU temperature, RAM,
pipeline latency, cache hit rate, and error counts.

Usage:
    python scripts/monitor.py
    python scripts/monitor.py --interval 5    # Update every 5 seconds
    python scripts/monitor.py --json          # Output JSON (for automation)
"""

import os
import sys
import time
import argparse
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_cpu_temp():
    """Read CPU temperature (works on RPi5 and Linux)."""
    paths = [
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/class/hwmon/hwmon0/temp1_input",
    ]
    for path in paths:
        try:
            with open(path) as f:
                return int(f.read().strip()) / 1000.0
        except (FileNotFoundError, ValueError):
            continue
    return 0.0


def get_memory_info():
    """Get memory usage."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        return {
            "total_gb": round(mem.total / (1024**3), 1),
            "used_gb": round(mem.used / (1024**3), 1),
            "percent": mem.percent,
            "available_gb": round(mem.available / (1024**3), 1),
        }
    except ImportError:
        return {"total_gb": 0, "used_gb": 0, "percent": 0, "available_gb": 0}


def get_process_info():
    """Get BhashaSakha process info."""
    try:
        import psutil
        for proc in psutil.process_iter(["pid", "name", "memory_info", "cpu_percent"]):
            if "bhashasakha" in proc.info["name"].lower() or \
               "src.main" in " ".join(proc.cmdline()):
                return {
                    "pid": proc.info["pid"],
                    "rss_mb": round(proc.info["memory_info"].rss / (1024**2), 1),
                    "cpu_percent": proc.info["cpu_percent"],
                    "status": "running",
                }
    except Exception:
        pass
    return {"pid": 0, "rss_mb": 0, "cpu_percent": 0, "status": "not running"}


def get_disk_info():
    """Get disk usage for model directory."""
    try:
        import psutil
        usage = psutil.disk_usage("/")
        return {
            "total_gb": round(usage.total / (1024**3), 1),
            "used_gb": round(usage.used / (1024**3), 1),
            "free_gb": round(usage.free / (1024**3), 1),
            "percent": usage.percent,
        }
    except ImportError:
        return {"total_gb": 0, "used_gb": 0, "free_gb": 0, "percent": 0}


def get_service_status():
    """Check systemd service status."""
    try:
        import subprocess
        result = subprocess.run(
            ["systemctl", "is-active", "bhashasakha"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def get_model_status():
    """Check if all model files exist."""
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
    models = {
        "vad": os.path.join(base, "vad", "silero_vad.onnx"),
        "stt": os.path.join(base, "stt", "whisper-small-int8", "model.bin"),
        "nllb": os.path.join(base, "translation", "nllb-200-distilled-600M-ct2-int8", "model.bin"),
    }
    status = {}
    for name, path in models.items():
        if os.path.exists(path):
            size_mb = os.path.getsize(path) / (1024 * 1024)
            status[name] = f"✓ ({size_mb:.0f}MB)"
        else:
            status[name] = "✗ MISSING"
    return status


def temp_bar(temp):
    """Create a visual temperature bar."""
    if temp == 0:
        return "N/A"
    zones = [(55, "🟢"), (65, "🟡"), (75, "🟠"), (80, "🔴"), (100, "🔥")]
    icon = "🟢"
    for threshold, emoji in zones:
        if temp <= threshold:
            icon = emoji
            break
    bar_len = min(int(temp / 2), 50)
    return f"{icon} {'█' * bar_len} {temp:.1f}°C"


def mem_bar(percent):
    """Create a visual memory bar."""
    bar_len = int(percent / 2)
    if percent < 50:
        color = "🟢"
    elif percent < 75:
        color = "🟡"
    else:
        color = "🔴"
    return f"{color} {'█' * bar_len}{'░' * (50 - bar_len)} {percent:.0f}%"


def display_dashboard(interval=2):
    """Display live monitoring dashboard."""
    try:
        while True:
            os.system("clear" if os.name != "nt" else "cls")

            cpu_temp = get_cpu_temp()
            memory = get_memory_info()
            process = get_process_info()
            disk = get_disk_info()
            service = get_service_status()
            models = get_model_status()

            print("╔══════════════════════════════════════════════════════════════════════╗")
            print("║              BhashaSakha System Monitor                              ║")
            print("╠══════════════════════════════════════════════════════════════════════╣")
            print(f"║  Service: {service:12s}  │  PID: {process['pid']:<8}  │  Uptime: N/A        ║")
            print("╠══════════════════════════════════════════════════════════════════════╣")
            print(f"║  CPU Temp:  {temp_bar(cpu_temp):60s} ║")
            print(f"║  RAM:       {mem_bar(memory['percent']):60s} ║")
            print(f"║             {memory['used_gb']:.1f}GB / {memory['total_gb']:.1f}GB ({memory['available_gb']:.1f}GB free){' ' * 24}║")
            print(f"║  Disk:      {disk['used_gb']:.0f}GB / {disk['total_gb']:.0f}GB ({disk['percent']:.0f}%){' ' * 30}║")
            print(f"║  Process:   RSS={process['rss_mb']:.0f}MB  CPU={process['cpu_percent']:.0f}%{' ' * 35}║")
            print("╠══════════════════════════════════════════════════════════════════════╣")
            print("║  Models                                                              ║")
            for name, status in models.items():
                print(f"║    {name:10s}: {status:54s} ║")
            print("╠══════════════════════════════════════════════════════════════════════╣")
            print(f"║  Updated: {time.strftime('%H:%M:%S')}  │  Interval: {interval}s  │  Ctrl+C to exit     ║")
            print("╚══════════════════════════════════════════════════════════════════════╝")

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\nMonitor stopped.")


def output_json():
    """Output metrics as JSON (for automation/logging)."""
    data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "cpu_temp_c": get_cpu_temp(),
        "memory": get_memory_info(),
        "disk": get_disk_info(),
        "process": get_process_info(),
        "service": get_service_status(),
        "models": get_model_status(),
    }
    print(json.dumps(data, indent=2))


def main():
    parser = argparse.ArgumentParser(description="BhashaSakha System Monitor")
    parser.add_argument("--interval", type=int, default=2, help="Update interval (seconds)")
    parser.add_argument("--json", action="store_true", help="Output JSON (single snapshot)")
    args = parser.parse_args()

    if args.json:
        output_json()
    else:
        display_dashboard(args.interval)


if __name__ == "__main__":
    main()
