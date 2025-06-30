from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import pandas as pd
import time
import firebase_admin
from firebase_admin import credentials, db

# Configurar o Selenium para rodar sem interface (headless)
options = webdriver.ChromeOptions()
options.add_argument('--headless')
options.add_argument('--no-sandbox')
options.add_argument('--disable-dev-shm-usage')

# Iniciar o driver do Chrome
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

# Inicializar o Firebase com o SDK
try:
    cred = credentials.Certificate('credentials.json')
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://fpfsdoispontozero-default-rtdb.firebaseio.com/'
    })
    print("Firebase inicializado com sucesso")
except Exception as e:
    print(f"Erro ao inicializar o Firebase: {e}")
    exit(1)

# Referências aos nós do Firebase
classificacao_ref = db.reference('classificacao')
jogos_ref = db.reference('jogos')
artilharia_ref = db.reference('artilharia')
links_ref = db.reference('links')

# Função para extrair tabela de classificação
def extract_classificacao(url):
    try:
        driver.get(url)
        time.sleep(5)  # Espera inicial
        table_classificacao = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, '.classification_table'))
        rows_classificacao = table_classificacao.find_elements(By.TAG_NAME, 'tr')
        data_classificacao = []
        for row in rows_classificacao:
            cols = row.find_elements(By.TAG_NAME, 'td')
            cols = [col.text for col in cols]
            data_classificacao.append(cols)
        df_classificacao = pd.DataFrame(data_classificacao)
        print(f"Dados de classificação extraídos de {url}: {len(data_classificacao)} linhas.")
        return df_classificacao
    except Exception as e:
        print(f"Erro ao extrair classificação de {url}: {str(e)}")
        return pd.DataFrame()

# Função para extrair tabela de jogos
def extract_jogos(url):
    try:
        driver.get(url)
        time.sleep(5)  # Espera inicial
        table_jogos = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'table'))
        rows_jogos = table_jogos.find_elements(By.TAG_NAME, 'tr')
        data_jogos = []
        for row in rows_jogos:
            cols = row.find_elements(By.TAG_NAME, 'td')
            cols = [col.text.replace("Ver Súmula", "").strip() for col in cols]
            data_jogos.append(cols)

        formatted_jogos = []
        for row in data_jogos:
            if len(row) < 4:
                continue
            data = row[0] if len(row) > 0 else ""
            if data and len(data.split('/')) == 2:
                data = f"{data}/2025"
            horario = row[1] if len(row) > 1 else ""
            ginasio = row[2] if len(row) > 2 else ""
            ultima_coluna = row[-1] if row else ""

            mandante = ""
            placar1 = ""
            placar2 = ""
            visitante = ""

            partes = ultima_coluna.split()
            placar_index = -1
            for i, parte in enumerate(partes):
                if parte.lower() == "x" and i > 0 and i < len(partes)-1 and partes[i-1].isdigit() and partes[i+1].isdigit():
                    placar_index = i
                    placar1 = partes[i-1]
                    placar2 = partes[i+1]
                    break

            if placar_index != -1:
                mandante = " ".join(partes[:placar_index-1]).strip()
                visitante = " ".join(partes[placar_index+2:]).strip()

            formatted_jogos.append([data, horario, ginasio, mandante, placar1, "X", placar2, visitante])

        df_jogos = pd.DataFrame(formatted_jogos, columns=["Data", "Horário", "Ginásio", "Mandante", "Placar 1", "X", "Placar 2", "Visitante"])
        print(f"Dados de jogos formatados de {url}: {len(formatted_jogos)} linhas.")
        return df_jogos
    except Exception as e:
        print(f"Erro ao extrair jogos de {url}: {str(e)}")
        return pd.DataFrame(columns=["Data", "Horário", "Ginásio", "Mandante", "Placar 1", "X", "Placar 2", "Visitante"])

# Função para extrair tabela de artilharia
def extract_artilharia(url):
    try:
        driver.get(url)
        time.sleep(5)  # Espera inicial
        table_artilharia = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'table'))
        rows_artilharia = table_artilharia.find_elements(By.TAG_NAME, 'tr')
        data_artilharia = []
        for row in rows_artilharia:
            cols = row.find_elements(By.TAG_NAME, 'td')
            cols = [col.text.strip() for col in cols]
            data_artilharia.append(cols)
        df_artilharia = pd.DataFrame(data_artilharia)
        print(f"Dados de artilharia extraídos de {url}: {len(data_artilharia)} linhas.")
        return df_artilharia
    except Exception as e:
        print(f"Erro ao extrair artilharia de {url}: {str(e)}")
        return pd.DataFrame()

# Ler links do Firebase
try:
    links = links_ref.get()
    if not links:
        print("Nenhum link encontrado no Firebase. Usando links padrão.")
        links = {
            'default_classificacao': {'Link': 'https://eventos.admfutsal.com.br/evento/864', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'classificacao'},
            'default_jogos': {'Link': 'https://eventos.admfutsal.com.br/evento/864/jogos', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'jogos'},
            'default_artilharia': {'Link': 'https://eventos.admfutsal.com.br/evento/864/artilharia', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'artilharia'}
        }
except Exception as e:
    print(f"Erro ao ler links do Firebase: {str(e)}")
    links = {
        'default_classificacao': {'Link': 'https://eventos.admfutsal.com.br/evento/864', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'classificacao'},
        'default_jogos': {'Link': 'https://eventos.admfutsal.com.br/evento/864/jogos', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'jogos'},
        'default_artilharia': {'Link': 'https://eventos.admfutsal.com.br/evento/864/artilharia', 'Divisao': 'A1', 'Categoria': 'Sub-9', 'Ano': '2025', 'type': 'artilharia'}
    }

# Processar cada link
df_classificacao_list = []
df_jogos_list = []
df_artilharia_list = []

for key, link_data in links.items():
    # Validar que todos os campos necessários estão presentes
    required_fields = ['Link', 'Divisao', 'Categoria', 'Ano', 'type']
    if not all(field in link_data for field in required_fields):
        print(f"Ignorando link inválido {key}: faltam campos obrigatórios")
        continue

    url = link_data['Link']
    link_type = link_data['type']
    divisao = link_data['Divisao']
    categoria = link_data['Categoria']
    ano = link_data['Ano']

    print(f"Processando link: {url} (tipo: {link_type}, Divisao: {divisao}, Categoria: {categoria}, Ano: {ano})")
    
    if link_type == 'classificacao':
        df = extract_classificacao(url)
        if not df.empty:
            df['Divisao'] = divisao
            df['Categoria'] = categoria
            df['Ano'] = ano
            df_classificacao_list.append(df)
    elif link_type == 'jogos':
        df = extract_jogos(url)
        if not df.empty:
            df['Divisao'] = divisao
            df['Categoria'] = categoria
            df['Ano'] = ano
            df_jogos_list.append(df)
    elif link_type == 'artilharia':
        df = extract_artilharia(url)
        if not df.empty:
            df['Divisao'] = divisao
            df['Categoria'] = categoria
            df['Ano'] = ano
            df_artilharia_list.append(df)
    else:
        print(f"Tipo de link desconhecido: {link_type}")

# Combinar DataFrames, se houver múltiplos, e redefinir o índice começando de 1
df_classificacao = pd.concat(df_classificacao_list, ignore_index=True) if df_classificacao_list else pd.DataFrame()
if not df_classificacao.empty:
    df_classificacao['Index'] = range(1, len(df_classificacao) + 1)

df_jogos = pd.concat(df_jogos_list, ignore_index=True) if df_jogos_list else pd.DataFrame(columns=["Data", "Horário", "Ginásio", "Mandante", "Placar 1", "X", "Placar 2", "Visitante", "Divisao", "Categoria", "Ano"])
if not df_jogos.empty:
    df_jogos['Index'] = range(1, len(df_jogos) + 1)

df_artilharia = pd.concat(df_artilharia_list, ignore_index=True) if df_artilharia_list else pd.DataFrame()
if not df_artilharia.empty:
    df_artilharia['Index'] = range(1, len(df_artilharia) + 1)

# Fechar o navegador
driver.quit()

# Verificar se os DataFrames estão vazios
if df_classificacao.empty and df_jogos.empty and df_artilharia.empty:
    print("Erro: Nenhum dado foi extraído.")
    exit(1)

# Função para salvar DataFrame no Firebase com hierarquia Ano/Divisao/Categoria
def save_to_firebase(df, ref, table_name):
    for index, row in df.iterrows():
        ano = row['Ano']
        divisao = row['Divisao']
        categoria = row['Categoria']
        row_key = f"{ano}_{row['Index']}"  # Usar o valor da coluna 'Index' para unicidade
        try:
            # Criar referência com hierarquia Ano/Divisao/Categoria
            child_ref = ref.child(ano).child(divisao).child(categoria).child(row_key)
            # Remover campos Ano, Divisao, Categoria, Index do dicionário para evitar duplicação
            row_dict = row.drop(['Ano', 'Divisao', 'Categoria', 'Index']).to_dict()
            print(f"Tentando gravar linha de {table_name} {row_key} ({ano}/{divisao}/{categoria}): {row_dict}")
            child_ref.set(row_dict)
            print(f"Linha de {table_name} {row_key} gravada com sucesso")
        except Exception as e:
            print(f"Erro ao gravar linha de {table_name} {row_key}: {str(e)}")

# Enviar dados para o Firebase
if not df_classificacao.empty:
    save_to_firebase(df_classificacao, classificacao_ref, "classificacao")

if not df_jogos.empty:
    save_to_firebase(df_jogos, jogos_ref, "jogos")

if not df_artilharia.empty:
    save_to_firebase(df_artilharia, artilharia_ref, "artilharia")