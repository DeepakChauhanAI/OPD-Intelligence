from fastapi import FastAPI
import os

app = FastAPI()

@app.get('/api/key')
def get_api_key():
    return {"api_key": os.getenv('OPD_API_KEY')}

@app.post('/api/bridge')
def bridge_server_endpoint(data):
    # Implement bridge server logic here
    return {"status": "success"}