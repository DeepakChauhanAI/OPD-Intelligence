# Ayurveda OPD Intelligence 🌿

An AI-powered Clinical Decision Support System (CDSS) for Ayurvedic Outpatient Departments. This application streamlines patient intake, doctor dictations, and post-visit follow-ups using real-time voice intelligence.

## 🚀 Key Features

- **Voice-to-Voice Patient Intake**: An empathetic AI assistant (Dhara) collects patient history, symptoms, and lifestyle details in English, Hindi, or Hinglish.
- **Real-time Doctor Dictation**: Doctors can dictate clinical notes which are transcribed and structured in real-time using Gemini Multimodal Live.
- **Clinical Data Extraction**: Automatically structures symptoms, diagnosis (Ayurvedic & ICD-11), herbal prescriptions, and lifestyle advice.
- **Automated Patient Check-ins**: Generates personalized daily follow-up questions based on the doctor's prescription to track adherence and recovery.
- **Persistent Electronic Health Records**: Full SQLite integration for patient history and visit records.

## 🛠️ Technology Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Lucide React, Zustand.
- **Backend**: FastAPI (Python), SQLite, WebSockets.
- **AI/ML**: Google Gemini 2.0 (Pro & Flash), Multimodal Live API.

## 📋 Prerequisites

- Node.js (v18+)
- Python (3.9+)
- Google Gemini API Key

## ⚙️ Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/DeepakChauhanAI/OPD-Intelligence.git
cd OPD-Intelligence
```

### 2. Backend Setup
```bash
# Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file and add your API key
echo "GEMINI_API_KEY=your_api_key_here" > .env
```

### 3. Frontend Setup
```bash
npm install
```

### 4. Running the Application
```bash
# Start the backend server
python server.py

# In a new terminal, start the frontend
npm run dev
```

## 📄 License

This project is licensed under the MIT License.
