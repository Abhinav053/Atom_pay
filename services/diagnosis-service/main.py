import os
import json
import logging
from enum import Enum
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AtomPay Diagnosis Service")

# Initialize Gemini Client
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = None
if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    logger.warning("GEMINI_API_KEY not found in environment variables. Diagnosis will fallback to UNKNOWN.")

class FailureCategory(str, Enum):
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    BANK_DECLINE = "BANK_DECLINE"
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    CARD_EXPIRED = "CARD_EXPIRED"
    INVALID_PAYMENT_DETAILS = "INVALID_PAYMENT_DETAILS"
    RISK_HOLD = "RISK_HOLD"
    UNKNOWN = "UNKNOWN"

class DiagnosisRequest(BaseModel):
    paymentId: str
    amount: float
    provider: str
    paymentMethod: Optional[str] = "UNKNOWN"
    failureCode: Optional[str] = None
    failureMessage: Optional[str] = None
    attemptCount: int
    previousProviders: Optional[list[str]] = []

class DiagnosisResponse(BaseModel):
    category: FailureCategory
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str

@app.post("/diagnose", response_model=DiagnosisResponse)
async def diagnose_payment_failure(request: DiagnosisRequest):
    if not client:
        return DiagnosisResponse(
            category=FailureCategory.UNKNOWN,
            confidence=0.0,
            evidence="Gemini API Key missing or client uninitialized."
        )

    prompt = f"""
You are an expert payment failure diagnosis AI.
Analyze the following payment failure context and classify it into exactly one of the allowed categories.

Context:
Payment ID: {request.paymentId}
Amount: {request.amount}
Provider: {request.provider}
Payment Method: {request.paymentMethod}
Failure Code: {request.failureCode}
Failure Message: {request.failureMessage}
Attempt Count: {request.attemptCount}
Previous Providers: {request.previousProviders}

Based strictly on this context, classify the failure.
If it is a network error or gateway timeout, choose NETWORK_TIMEOUT.
If the bank explicitly declined it without specifying funds, choose BANK_DECLINE.
If funds are insufficient, choose INSUFFICIENT_FUNDS.
If the provider returned an internal error, choose PROVIDER_ERROR.
If the card is expired, choose CARD_EXPIRED.
If details are invalid, choose INVALID_PAYMENT_DETAILS.
If there's suspected fraud or risk, choose RISK_HOLD.
Otherwise, choose UNKNOWN.
"""

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DiagnosisResponse,
                temperature=0.0,
            ),
        )
        
        text = response.text
        if not text:
            raise ValueError("Empty response text from Gemini API")
    
        result = json.loads(text)
        
        return DiagnosisResponse(**result)
    
    except Exception as e:
        logger.error(f"Error calling Gemini: {e}")
        return DiagnosisResponse(
            category=FailureCategory.UNKNOWN,
            confidence=0.0,
            evidence=f"Fallback due to AI service error: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
