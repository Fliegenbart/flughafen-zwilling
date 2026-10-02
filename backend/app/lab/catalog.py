from .models import Bench, Criteria

CASES = [
    {
        "id": "setpoint-step",
        "name": "Sollwertsprung",
        "description": (
            "Nach 30 s wird die Ladeleistung angehoben. Reaktion und Sollwerttreue pruefen."
        ),
        "tag": "Regelverhalten",
    },
    {
        "id": "flex-reduction",
        "name": "Flex-Abregelung",
        "description": (
            "Nach 30 s wird die angeforderte Leistung abgesenkt. Abregelung und Erholung messen."
        ),
        "tag": "Flexibilitaet",
    },
    {
        "id": "power-cap",
        "name": "Anschlusslimit",
        "description": (
            "Nach 30 s sinkt das Leistungslimit. Der begrenzte Sollwert muss eingehalten werden."
        ),
        "tag": "Netzgrenze",
    },
    {
        "id": "telemetry-loss",
        "name": "Telemetrieausfall",
        "description": (
            "Zwischen 60 und 80 s fehlen Ist-Werte. "
            "Datenqualitaet muss einen scheinbaren PASS verhindern."
        ),
        "tag": "Datenqualitaet",
    },
]


def catalog():
    return {
        "product": "FlexLab Workbench",
        "version": "1.0",
        "read_only": True,
        "live_connection": False,
        "cases": CASES,
        "default_bench": Bench().model_dump(),
        "default_criteria": Criteria().model_dump(),
        "csv_columns": ["ts_s", "power_kw", "setpoint_kw", "limit_kw"],
        "limits": {"max_import_bytes": 5_000_000, "max_samples": 100_000},
    }
