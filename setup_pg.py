import psycopg2

def setup_postgres():
    conn = psycopg2.connect(dbname='postgres', user='postgres', host='localhost', port='5432')
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("ALTER USER postgres WITH PASSWORD 'postgrespassword';")
    print("User 'postgres' password set to 'postgrespassword'.")
    
    cur.execute("SELECT 1 FROM pg_database WHERE datname='sih_thermal_db'")
    if not cur.fetchone():
        cur.execute("CREATE DATABASE sih_thermal_db;")
        print("Database 'sih_thermal_db' created successfully.")
    else:
        print("Database 'sih_thermal_db' already exists.")
        
    cur.close()
    conn.close()

if __name__ == "__main__":
    setup_postgres()
