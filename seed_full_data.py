import sqlite3
import json
from datetime import datetime, timedelta
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opd_data.db")

def seed_full_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get patients
    patients = c.execute("SELECT id, name, chief_complaint FROM patients").fetchall()
    
    now = datetime.now()
    
    count = 0
    for idx, (p_id, name, chief_complaint) in enumerate(patients):
        
        # --- 1. Intake ---
        intake_id = f"intake-{int(now.timestamp() * 1000) + idx}"
        extraction_json = {
            "status": "complete",
            "patient": {
                "name": name,
                "chiefComplaint": chief_complaint,
                "symptoms": ["pain", "discomfort", "fatigue"],
                "duration": "A few weeks",
                "severity": "moderate",
                "dosha": "Vata-Pitta",
                "prakriti": "Vata",
                "redFlags": []
            },
            "ayurvedic_assessment": {
                "dosha_imbalance": ["Vata aggravation", "Pitta disturbance"],
                "probable_diagnosis": "Vataja condition",
                "suggested_herbs": ["Ashwagandha", "Guduchi", "Triphala"],
                "lifestyle_advice": ["Eat warm, cooked meals", "Avoid cold draft", "Sleep by 10 PM"],
                "further_investigation": ["Routine blood test"]
            }
        }
        
        c.execute(
            """INSERT INTO intakes (id, patient_id, chief_complaint, raw_transcript, extraction_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (intake_id, p_id, chief_complaint, "Patient arrived and complained about severe discomfort and fatigue over the last few weeks...", json.dumps(extraction_json), (now - timedelta(days=2)).isoformat())
        )
        
        # --- 2. Dictation ---
        dict_id = f"dict-{int(now.timestamp() * 1000) + idx}"
        structured_note = {
            "chief_complaint": chief_complaint,
            "history": "Patient presents with ongoing symptoms for several weeks. No previous history of similar ailments. Digestion is slightly irregular.",
            "examination": "Nadi pariksha reveals Vata dominance with Tikshna Pitta. Jivha (tongue) has slight white coating indicating Ama.",
            "diagnosis": "Vata-Pitta imbalance with mild Ama accumulation.",
            "prescription": [
                {
                    "name": "Amrutharishtam",
                    "dose": "15 ml with equal water",
                    "frequency": "Twice a day",
                    "duration": "14 days",
                    "route": "Oral after food"
                },
                {
                    "name": "Triphala Guggulu",
                    "dose": "2 tablets",
                    "frequency": "Twice a day",
                    "duration": "14 days",
                    "route": "Oral with warm water"
                }
            ],
            "follow_up": "Check back in exactly 2 weeks.",
            "advice": "Daily Abhyanga with warm sesame oil. Practice anulom vilom pranayama."
        }
        c.execute(
            """INSERT INTO dictations (id, patient_id, raw_transcript, structured_note, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (dict_id, p_id, "The patient has vata pitta imbalance, let's give amrutharishtam...", json.dumps(structured_note), "done", (now - timedelta(days=2)).isoformat())
        )
        
        # --- 3. Check-in ---
        checkin_id = f"checkin-{int(now.timestamp() * 1000) + idx}"
        responses = [
            {"question": "How is your primary complaint compared to last week?", "answer": "I am feeling a bit better. The pain has reduced."},
            {"question": "Have you been taking the prescribed herbs?", "answer": "Yes, regularly after food."},
            {"question": "Is your digestion improving?", "answer": "It is much better, less bloating."}
        ]
        summary = {
            "overall_status": "improving",
            "dosha_today": "Vata settling, Pitta calm",
            "key_observations": ["Pain level reduced", "Digestion improved", "Good medication compliance"],
            "recommendations": ["Continue current prescription for full 14 days", "Maintain warm diet"]
        }
        c.execute(
            """INSERT INTO checkins (id, patient_id, date, responses, summary, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (checkin_id, p_id, now.strftime("%Y-%m-%d"), json.dumps(responses), json.dumps(summary), now.isoformat())
        )
        
        count += 1
        
    conn.commit()
    conn.close()
    print(f"Successfully seeded full historical data (intake, dictation, checkin) for {count} patients!")

if __name__ == "__main__":
    seed_full_data()
