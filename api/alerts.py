import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
ALERT_RECIPIENT = os.getenv("ALERT_RECIPIENT", "security_alerts@ntro.gov.in")

def send_high_risk_alert(cluster_data: dict) -> bool:
    """
    Sends SMTP email alert when high risk thermal anomaly is detected.
    Falls back to console alert logger when SMTP settings are unconfigured.
    """
    cluster_id = cluster_data.get("id")
    risk_score = cluster_data.get("risk_score", 0.0)
    pred_class = cluster_data.get("predicted_class", "Unauthorized Persistent Thermal Source")
    lat = cluster_data.get("centroid_lat")
    lon = cluster_data.get("centroid_lon")
    frp = cluster_data.get("max_frp")
    dist = cluster_data.get("dist_to_nearest_industry_km")
    days = cluster_data.get("persistence_days")

    subject = f"[ALERT] HIGH RISK THERMAL ANOMALY - Risk Score: {risk_score}/100"
    
    body = f"""
    ===============================================================
    HIGH RISK THERMAL ANOMALY DETECTED (SIH26162 SYSTEM)
    ===============================================================
    
    Cluster ID: {cluster_id}
    Classification: {pred_class}
    Risk Score: {risk_score} / 100
    
    Location:
    - Coordinates: Lat {lat}, Lon {lon}
    - Map View: https://maps.google.com/?q={lat},{lon}
    
    Thermal Metrics:
    - Max FRP: {frp} MW
    - Persistence Duration: {days} days
    - Distance to Nearest Known Industry: {dist} km
    
    Action Required:
    Please access the SIH26162 Operations Dashboard to review SHAP feature attributions,
    perform visual verification, and record human confirmation.
    
    Dashboard Link: http://localhost:8000
    ===============================================================
    """

    if SMTP_USERNAME and SMTP_PASSWORD and SMTP_USERNAME != "your_email@gmail.com":
        try:
            msg = MIMEMultipart()
            msg['From'] = SMTP_USERNAME
            msg['To'] = ALERT_RECIPIENT
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
            server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
            server.quit()
            print(f"SMTP Email Alert successfully sent to {ALERT_RECIPIENT} for cluster #{cluster_id}")
            return True
        except Exception as e:
            print(f"Failed to send SMTP email: {e}")
    
    # Console alert fallback
    print(f"\n[ALERT NOTIFICATION LOG]\n{subject}\n{body}\n")
    return True
