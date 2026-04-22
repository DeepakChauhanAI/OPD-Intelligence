import sqlite3
import json
from datetime import datetime
import os

DB_PATH = "ayurveda_opd.db"

# We fall back to opd_data.db since I noticed in server.py:
# DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opd_data.db")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opd_data.db")

mock_patients = [
    {
        "id": f"patient-{int(datetime.now().timestamp() * 1000) + 1}",
        "name": "Ramesh Kumar",
        "age": 45,
        "gender": "male",
        "chief_complaint": "Severe lower back pain",
        "symptoms": ["back pain", "stiffness", "numbness in right leg"],
        "duration": "2 weeks",
        "severity": "severe",
        "dosha": "Vata",
        "prakriti": "Vata-Pitta",
        "vitals": {"bp": "130/85", "pulse": 78},
        "red_flags": []
    },
    {
        "id": f"patient-{int(datetime.now().timestamp() * 1000) + 2}",
        "name": "Sneha Sharma",
        "age": 32,
        "gender": "female",
        "chief_complaint": "Acid reflux and bloating",
        "symptoms": ["heartburn", "bloating after meals", "nausea"],
        "duration": "3 months",
        "severity": "moderate",
        "dosha": "Pitta",
        "prakriti": "Pitta-Kapha",
        "vitals": {"bp": "110/70", "pulse": 72},
        "red_flags": []
    },
    {
        "id": f"patient-{int(datetime.now().timestamp() * 1000) + 3}",
        "name": "Aarav Patel",
        "age": 55,
        "gender": "male",
        "chief_complaint": "Joint pain in knees",
        "symptoms": ["knee pain", "swelling", "crepitus"],
        "duration": "1 year",
        "severity": "moderate",
        "dosha": "Kapha",
        "prakriti": "Kapha",
        "vitals": {"bp": "140/90", "pulse": 82, "weight": 85},
        "red_flags": []
    },
    {
        "id": f"patient-{int(datetime.now().timestamp() * 1000) + 4}",
        "name": "Priya Singh",
        "age": 28,
        "gender": "female",
        "chief_complaint": "Irregular periods and hair fall",
        "symptoms": ["irregular cycles", "hair fall", "fatigue", "acne"],
        "duration": "6 months",
        "severity": "mild",
        "dosha": "Vata-Pitta",
        "prakriti": "Vata",
        "vitals": {"bp": "120/80", "pulse": 75},
        "red_flags": []
    },
    {
        "id": f"patient-{int(datetime.now().timestamp() * 1000) + 5}",
        "name": "Vikram Desai",
        "age": 62,
        "gender": "male",
        "chief_complaint": "Chronic cough and breathlessness",
        "symptoms": ["dry cough", "breathlessness on exertion", "wheezing"],
        "duration": "2 months",
        "severity": "severe",
        "dosha": "Vata-Kapha",
        "prakriti": "Kapha-Vata",
        "vitals": {"bp": "135/85", "pulse": 88},
        "red_flags": []
    }
]

def seed_db():
    print(f"Opening DB: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    now = datetime.now().isoformat()
    
    count = 0
    for p in mock_patients:
        c.execute(
            """INSERT INTO patients (id, name, age, gender, chief_complaint, symptoms, 
               duration, severity, dosha, prakriti, vitals, red_flags, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (p["id"], p["name"], p["age"], p["gender"], p["chief_complaint"],
             json.dumps(p["symptoms"]), p["duration"], p["severity"],
             p["dosha"], p["prakriti"], json.dumps(p["vitals"]), json.dumps(p["red_flags"]), now, now)
        )
        count += 1
        
    conn.commit()
    conn.close()
    print(f"✅ Successfully seeded {count} mock patients!")

if __name__ == '__main__':
    seed_db()
