console.log('Script.js iniciado');

const FIREBASE_URL = 'https://fpfsdoispontozero-default-rtdb.firebaseio.com/';
const CACHE_DURATION = 3600000; // 1 hora em milissegundos
let allDataSheet1 = []; // Dados do nó jogos
let allDataClassification = []; // Dados do nó classificacao
let allDataArtilharia = []; // Dados do nó artilharia
let golsPorTimeChart = null; // Referência ao gráfico Chart.js
let golsTomadosChart = null; // Referência ao gráfico de gols tomados
let timesApelidos = {}; // Mapa de times/clubes para apelidos
let sortConfigEstatisticas = { mode: 'gols' }; // Modo de ordenação: 'gols' ou 'classificacao'
let globalFilters = { divisao: '', categoria: '' }; // Filtros globais

// Função auxiliar para calcular regressão polinomial de grau 2
function calculatePolynomialRegression(data, degree = 2) {
    if (!data.every(val => typeof val === 'number' && !isNaN(val))) {
        console.warn('Dados inválidos para regressão polinomial:', data);
        return Array(data.length).fill(0);
    }
    if (data.length < 2) return Array(data.length).fill(0);
    
    const x = data.map((_, i) => i);
    const y = data;
    const n = x.length;

    const X = x.map(xi => Array(degree + 1).fill().map((_, j) => Math.pow(xi, j)));
    const Y = y.map(yi => [yi]);

    function multiplyMatrix(A, B) {
        const result = Array(A.length).fill().map(() => Array(B[0].length).fill(0));
        for (let i = 0; i < A.length; i++) {
            for (let j = 0; j < B[0].length; j++) {
                for (let k = 0; k < A[0].length; k++) {
                    result[i][j] += A[i][k] * B[k][j];
                }
            }
        }
        return result;
    }

    function transposeMatrix(A) {
        return A[0].map((_, colIndex) => A.map(row => row[colIndex]));
    }

    function inverseMatrix3x3(A) {
        const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
                    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
                    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
        if (Math.abs(det) < 1e-10) {
            console.error('Matriz não inversível (determinante próximo de zero)');
            return null;
        }
        const invDet = 1 / det;
        return [
            [
                invDet * (A[1][1] * A[2][2] - A[1][2] * A[2][1]),
                invDet * (A[0][2] * A[2][1] - A[0][1] * A[2][2]),
                invDet * (A[0][1] * A[1][2] - A[0][2] * A[1][1])
            ],
            [
                invDet * (A[1][2] * A[2][0] - A[1][0] * A[2][2]),
                invDet * (A[0][0] * A[2][2] - A[0][2] * A[2][0]),
                invDet * (A[0][2] * A[1][0] - A[0][0] * A[1][2])
            ],
            [
                invDet * (A[1][0] * A[2][1] - A[1][1] * A[2][0]),
                invDet * (A[0][1] * A[2][0] - A[0][0] * A[2][1]),
                invDet * (A[0][0] * A[1][1] - A[0][1] * A[1][0])
            ]
        ];
    }

    const Xt = transposeMatrix(X);
    const XtX = multiplyMatrix(Xt, X);
    const XtX_inv = inverseMatrix3x3(XtX);
    if (!XtX_inv) return Array(n).fill(0);
    const XtY = multiplyMatrix(Xt, Y);
    const coefficients = multiplyMatrix(XtX_inv, XtY).flat();

    return x.map(xi => {
        let result = 0;
        for (let j = 0; j <= degree; j++) {
            result += coefficients[j] * Math.pow(xi, j);
        }
        return Math.max(0, result);
    });
}

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function normalizeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

async function fetchTimesApelidos() {
    const cacheKey = 'times_apelidos_cache';
    const cachedData = localStorage.getItem(cacheKey);
    const cacheTime = localStorage.getItem(`${cacheKey}_time`);
    if (cachedData && cacheTime && Date.now() - cacheTime < CACHE_DURATION) {
        try {
            timesApelidos = JSON.parse(cachedData);
            if (typeof timesApelidos !== 'object' || timesApelidos === null) {
                console.warn('Cache de times_apelidos inválido, buscando dados novos.');
                throw new Error('Cache inválido');
            }
            console.log('Mapa de times_apelidos carregado do cache:', timesApelidos);
            return timesApelidos;
        } catch (error) {
            console.error('Erro ao parsear cache de times_apelidos:', error);
            localStorage.removeItem(cacheKey);
            localStorage.removeItem(`${cacheKey}_time`);
        }
    }
    const url = `${FIREBASE_URL}times_apelidos.json?cacheBuster=${Date.now()}`;
    console.log('Iniciando requisição ao Firebase para times_apelidos:', url);
    try {
        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error(`Erro ao carregar times_apelidos: ${response.status}`);
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
            console.warn('Nenhum dado retornado para times_apelidos.');
            showError('Tabela de apelidos vazia. Usando nomes originais.');
            return {};
        }
        const apelidosMap = {};
        Object.entries(data).forEach(([key, row]) => {
            if (row['Time'] && row['Apelido'] && typeof row['Time'] === 'string' && typeof row['Apelido'] === 'string') {
                apelidosMap[row['Time']] = row['Apelido'];
                console.log(`Mapeado: ${row['Time']} -> ${row['Apelido']}`);
            } else {
                console.warn(`Entrada inválida em times_apelidos (chave ${key}):`, row);
            }
        });
        localStorage.setItem(cacheKey, JSON.stringify(apelidosMap));
        localStorage.setItem(`${cacheKey}_time`, Date.now());
        console.log('Mapa de times_apelidos:', apelidosMap);
        return apelidosMap;
    } catch (error) {
        console.error('Erro ao buscar times_apelidos:', error.message);
        showError(`Erro ao carregar times_apelidos: ${error.message}. Usando nomes originais.`);
        return {};
    }
}

async function fetchDivisoes() {
    const url = `${FIREBASE_URL}jogos/2025.json?cacheBuster=${Date.now()}`;
    console.log('Buscando divisões:', url);
    try {
        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error(`Erro ao carregar divisões: ${response.status}`);
        const data = await response.json();
        console.log('Dados brutos de /jogos/2025:', data);
        if (!data || Object.keys(data).length === 0) {
            console.warn('Nenhuma divisão encontrada.');
            return [];
        }
        const divisoes = [...new Set(Object.keys(data).map(divisao => divisao.trim().toUpperCase()))].sort();
        console.log('Divisões deduplicadas e ordenadas:', divisoes);
        return divisoes;
    } catch (error) {
        console.error('Erro ao buscar divisões:', error.message);
        showError(`Erro ao carregar divisões da URL ${url}: ${error.message}`);
        return [];
    }
}

async function fetchCategorias(divisao) {
    if (!divisao) return [];
    const url = `${FIREBASE_URL}jogos/2025/${divisao}.json?cacheBuster=${Date.now()}`;
    console.log('Buscando categorias para divisão:', url);
    try {
        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error(`Erro ao carregar categorias: ${response.status}`);
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
            console.warn('Nenhuma categoria encontrada para divisão:', divisao);
            return [];
        }
        const categorias = Object.keys(data).sort((a, b) => {
            const matchA = a.match(/Sub-(\d+)/i);
            const matchB = b.match(/Sub-(\d+)/i);
            const numA = matchA ? parseInt(matchA[1]) : Infinity;
            const numB = matchB ? parseInt(matchB[1]) : Infinity;
            if (numA === Infinity && numB === Infinity) return a.localeCompare(b);
            return numA - numB;
        });
        console.log('Categorias ordenadas:', categorias);
        return categorias;
    } catch (error) {
        console.error('Erro ao buscar categorias:', error.message);
        showError(`Erro ao carregar categorias da URL ${url}: ${error.message}`);
        return [];
    }
}

function updateSelecaoAtual() {
    const selecaoAtual = document.getElementById('selecao-atual');
    if (!selecaoAtual) return;
    const divisao = document.getElementById('divisao-global').value || 'Nenhuma';
    const categoria = document.getElementById('categoria-global').value || 'Nenhuma';
    selecaoAtual.textContent = `Selecionado: ${divisao}, ${categoria}`;
    console.log('Label de seleção atualizado:', selecaoAtual.textContent);
}

async function populateGlobalFilters() {
    console.log('Populando filtros globais');
    const divisaoSelect = document.getElementById('divisao-global');
    const categoriaSelect = document.getElementById('categoria-global');
    if (!checkElement(divisaoSelect, '#divisao-global') || !checkElement(categoriaSelect, '#categoria-global')) return;

    globalFilters.divisao = localStorage.getItem('global_divisao') || '';
    globalFilters.categoria = localStorage.getItem('global_categoria') || '';
    console.log('Filtros globais carregados do cache:', globalFilters);

    divisaoSelect.innerHTML = '';
    const divisoes = await fetchDivisoes();
    if (divisoes.length === 0) {
        showError('Nenhuma divisão disponível. Verifique os dados no Firebase.');
        divisaoSelect.innerHTML = '<option value="Nenhuma">Nenhuma divisão</option>';
        globalFilters.divisao = 'Nenhuma';
        updateSelecaoAtual();
        return;
    }
    divisoes.forEach(divisao => {
        const option = document.createElement('option');
        option.value = divisao;
        option.textContent = divisao;
        divisaoSelect.appendChild(option);
    });
    if (globalFilters.divisao && divisoes.includes(globalFilters.divisao)) {
        divisaoSelect.value = globalFilters.divisao;
    } else if (divisoes.includes('A1')) {
        divisaoSelect.value = 'A1';
    } else {
        divisaoSelect.value = divisoes[0];
        console.warn('Divisão A1 não encontrada, usando fallback:', divisoes[0]);
    }
    globalFilters.divisao = divisaoSelect.value;

    await populateCategorias();
    updateSelecaoAtual();

    divisaoSelect.addEventListener('change', async () => {
        globalFilters.divisao = divisaoSelect.value;
        await populateCategorias();
        updateSelecaoAtual();
    });
    categoriaSelect.addEventListener('change', () => {
        globalFilters.categoria = categoriaSelect.value;
        updateSelecaoAtual();
    });
}

async function populateCategorias() {
    const categoriaSelect = document.getElementById('categoria-global');
    if (!checkElement(categoriaSelect, '#categoria-global')) return;
    categoriaSelect.innerHTML = '';
    let categorias = [];
    if (globalFilters.divisao && globalFilters.divisao !== 'Nenhuma') {
        categorias = await fetchCategorias(globalFilters.divisao);
    }
    if (categorias.length === 0) {
        showError(`Nenhuma categoria disponível para a divisão ${globalFilters.divisao}. Verifique os dados no Firebase.`);
        categoriaSelect.innerHTML = '<option value="Nenhuma">Nenhuma categoria</option>';
        globalFilters.categoria = 'Nenhuma';
        updateSelecaoAtual();
        return;
    }
    categorias.forEach(categoria => {
        const option = document.createElement('option');
        option.value = categoria;
        option.textContent = categoria;
        categoriaSelect.appendChild(option);
    });
    if (globalFilters.categoria && categorias.includes(globalFilters.categoria)) {
        categoriaSelect.value = globalFilters.categoria;
    } else if (categorias.includes('Sub-7')) {
        categoriaSelect.value = 'Sub-7';
    } else {
        categoriaSelect.value = categorias[0];
    }
    globalFilters.categoria = categoriaSelect.value;
    updateSelecaoAtual();
}

async function fetchFirebaseData(node) {
    let url = `${FIREBASE_URL}${node}`;
    let fallback = false;
    if (globalFilters.divisao && globalFilters.categoria && globalFilters.divisao !== 'Nenhuma' && globalFilters.categoria !== 'Nenhuma') {
        url += `/2025/${globalFilters.divisao}/${globalFilters.categoria}${node !== 'classificacao' ? '/2025_1' : ''}`;
    } else {
        url += '/2025';
    }
    url += `.json?cacheBuster=${Date.now()}`;
    console.log(`Iniciando requisição ao Firebase para ${node}:`, url);
    try {
        let response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        let data = await response.json();
        console.log(`Dados brutos de ${url}:`, data);
        if (!data || Object.keys(data).length === 0) {
            fallback = true;
            url = `${FIREBASE_URL}${node}/2025/${globalFilters.divisao}/${globalFilters.categoria}${node === 'classificacao' ? '/2025_1' : ''}.json?cacheBuster=${Date.now()}`;
            console.log(`Tentando fallback para ${node}:`, url);
            response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
            if (!response.ok) throw new Error(`Erro ${response.status} no fallback`);
            data = await response.json();
            console.log(`Dados brutos de fallback ${url}:`, data);
            if (!data || Object.keys(data).length === 0) {
                throw new Error(`Nó ${node} vazio ou não existe.`);
            }
        }
        let dataArray = [];
        if (node === 'jogos') {
            const headers = ['Campeonato', 'Data', 'Horário', 'Ginásio', 'Mandante', 'Placar 1', 'Placar 2', 'Visitante', 'Local', 'Rodada', 'Dia da Semana', 'Gol', 'Assistências', 'Vitória', 'Derrota', 'Empate', 'considerar', 'Index'];
            dataArray.push(headers);
            const seenRows = new Set();
            Object.entries(data).forEach(([key, row]) => {
                if (!row || typeof row !== 'object') {
                    console.warn(`Linha inválida em jogos (chave ${key}):`, row);
                    return;
                }
                const index = parseInt(key.split('_').pop()) || 0;
                const mandante = timesApelidos[row['Mandante']] || row['Mandante'] || '';
                const visitante = timesApelidos[row['Visitante']] || row['Visitante'] || '';
                const ginásio = toTitleCase(row['Ginásio'] || '');
                console.log(`Jogos - Mandante: ${row['Mandante']} -> ${mandante}, Visitante: ${row['Visitante']} -> ${visitante}, Ginásio: ${row['Ginásio']} -> ${ginásio}`);
                const rowArray = [
                    globalFilters.divisao && globalFilters.categoria ? `2025 ${globalFilters.divisao} ${globalFilters.categoria}` : '',
                    row['Data'] || '',
                    row['Horário'] || '',
                    ginásio,
                    mandante,
                    row['Placar 1'] || '',
                    row['Placar 2'] || '',
                    visitante,
                    '',
                    '',
                    '',
                    '',
                    '',
                    row['Placar 1'] && row['Placar 2'] ? (parseInt(row['Placar 1']) > parseInt(row['Placar 2']) ? '1' : '0') : '',
                    row['Placar 1'] && row['Placar 2'] ? (parseInt(row['Placar 1']) < parseInt(row['Placar 2']) ? '1' : '0') : '',
                    row['Placar 1'] && row['Placar 2'] ? (parseInt(row['Placar 1']) === parseInt(row['Placar 2']) ? '1' : '0') : '',
                    row['Considerar'] || '1',
                    index
                ];
                const rowKeyUnique = `${rowArray[1]}-${rowArray[4]}-${rowArray[7]}-${rowArray[5]}-${rowArray[6]}-${index}`;
                if (!seenRows.has(rowKeyUnique)) {
                    seenRows.add(rowKeyUnique);
                    dataArray.push(rowArray);
                } else {
                    console.warn(`Linha duplicada detectada e ignorada: ${rowKeyUnique}`);
                }
            });
        } else if (node === 'classificacao') {
            const headers = ['Index', 'Posição', 'Time', 'Pontos', 'Jogos', 'Vitórias', 'Empates', 'Derrotas', 'Gols Próprio', 'Gols Contra', 'Saldo', 'Aproveitamento'];
            dataArray.push(headers);
            Object.entries(data).forEach(([key, row]) => {
                if (!row || typeof row !== 'object' || !row['2'] || typeof row['2'] !== 'string' || row['2'].match(/^\d+$/)) {
                    console.warn(`Linha inválida em classificacao (chave ${key}):`, row);
                    return;
                }
                const index = parseInt(key.split('_').pop()) || 0;
                const time = timesApelidos[row['2']] || row['2'];
                console.log(`Classificação - Time: ${row['2']} -> ${time}`);
                dataArray.push([index, row['1'] || '', time, row['3'] || '', row['4'] || '', row['5'] || '', row['6'] || '', row['7'] || '', row['8'] || '', row['9'] || '', row['10'] || '', row['11'] || '']);
            });
        } else if (node === 'artilharia') {
            const headers = ['#', 'Jogador', 'Clube', 'Gols'];
            dataArray.push(headers);
            Object.entries(data).forEach(([key, row]) => {
                if (!row || typeof row !== 'object' || !row['1'] || !row['2']) {
                    console.warn(`Linha inválida em artilharia (chave ${key}):`, row);
                    return;
                }
                const index = parseInt(key.split('_').pop()) || 0;
                const clube = timesApelidos[row['2']] || row['2'];
                const jogador = toTitleCase(row['1'] || '');
                console.log(`Artilharia - Clube: ${row['2']} -> ${clube}, Jogador: ${row['1']} -> ${jogador}`);
                dataArray.push([index, jogador, clube, row['3'] || '']);
            });
        }
        console.log(`Dados convertidos para ${node}:`, dataArray);
        return dataArray;
    } catch (error) {
        console.error(`Erro ao buscar dados do ${node}:`, error.message);
        showError(`Erro ao carregar dados do nó ${node} na URL ${url}: ${error.message}. Verifique o caminho e a conexão com o Firebase${fallback ? ' e o schema correto' : ''}.`);
        return [];
    }
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        console.log('Erro exibido:', message);
    }
}

function clearError() {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.classList.add('hidden');
        console.log('Erro limpo');
    }
}

function checkElement(element, id) {
    if (!element) {
        console.error(`Elemento ${id} não encontrado`);
        return false;
    }
    return true;
}

function formatTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    const [hours, minutes] = timeStr.split(':').map(num => parseInt(num.trim()) || 0);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function populateFilters() {
    console.log('Populando filtros');
    const filters = [
        { id: 'clube', indices: [2], tab: 'estatisticas' },
        { id: 'jogador', indices: [1], tab: 'estatisticas' },
    ];
    filters.forEach(filter => {
        const select = document.getElementById(`${filter.id}-${filter.tab}`);
        if (!select) {
            console.error(`Falha ao encontrar ${filter.id}-${filter.tab}. DOM carregado:`, document.readyState);
            console.log('Seletores disponíveis:', Array.from(document.querySelectorAll('select')).map(el => el.id));
            setTimeout(() => {
                const retrySelect = document.getElementById(`${filter.id}-${filter.tab}`);
                if (retrySelect) {
                    console.log(`Seletor ${filter.id}-${filter.tab} encontrado na tentativa de retry`);
                    populateSelect(retrySelect, filter);
                } else {
                    console.error(`Retry falhou para ${filter.id}-${filter.tab}`);
                }
            }, 100);
            return;
        }
        populateSelect(select, filter);
    });

    function populateSelect(select, filter) {
        select.innerHTML = '<option value="">Todos</option>';
        const data = allDataArtilharia;
        const values = [...new Set(data.slice(1).flatMap(row => filter.indices.map(index => row[index]?.trim())).filter(v => v))].sort();
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        console.log(`Filtro ${filter.id}-${filter.tab} populado com valores:`, values);
    }
}

function sortData(data, columnIndex, direction) {
    const sortedData = [...data];
    sortedData.sort((a, b) => {
        let actualIndex = columnIndex;
        let valueA = a[actualIndex] || '';
        let valueB = b[actualIndex] || '';
        if ([5, 6, 18].includes(actualIndex)) {
            valueA = parseInt(valueA) || 0;
            valueB = parseInt(valueB) || 0;
            return direction === 'asc' ? valueA - valueB : valueB - valueA;
        }
        if (actualIndex === 1) {
            valueA = valueA ? new Date(valueA.split('/').reverse().join('-')) : new Date(0);
            valueB = valueB ? new Date(valueB.split('/').reverse().join('-')) : new Date(0);
            return direction === 'asc' ? valueA - valueB : valueB - valueA;
        }
        valueA = valueA.toString().toLowerCase();
        valueB = valueB.toString().toLowerCase();
        return direction === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
    });
    return sortedData;
}

function displayEstatisticas() {
    console.log('Exibindo dados da Estatísticas');
    clearError();
    const canvasGolsPorTime = document.getElementById('golsPorTimeChart');
    const canvasGolsTomados = document.getElementById('golsTomadosChart');
    if (!checkElement(canvasGolsPorTime, '#golsPorTimeChart') || !checkElement(canvasGolsTomados, '#golsTomadosChart')) {
        showError('Erro interno: canvas do gráfico não encontrado. Verifique o HTML.');
        return;
    }
    if (typeof Chart === 'undefined') {
        showError('Erro ao carregar o gráfico: Chart.js não está disponível. Verifique a importação do Chart.js.');
        return;
    }
    const filters = {
        clube: document.getElementById('clube-estatisticas')?.value || '',
        jogador: document.getElementById('jogador-estatisticas')?.value || ''
    };
    const filteredDataArtilharia = filterDataArtilharia(allDataArtilharia, filters);
    if (filteredDataArtilharia.length === 0 && allDataSheet1.length <= 1) {
        showError(`Nenhum dado disponível para os gráficos. Verifique os nós /jogos e /artilharia no Firebase para ${globalFilters.divisao}/${globalFilters.categoria}.`);
        return;
    }
    if (filteredDataArtilharia.length === 0) {
        showError(`Nenhum dado de artilharia disponível para ${globalFilters.divisao}/${globalFilters.categoria}. Verifique o nó /artilharia no Firebase.`);
    }
    if (allDataSheet1.length <= 1) {
        showError(`Nenhum dado de jogos disponível para ${globalFilters.divisao}/${globalFilters.categoria}. Verifique o nó /jogos no Firebase.`);
    }
    const golsPorTime = {};
    filteredDataArtilharia.forEach(row => {
        const time = row[2];
        const gols = parseInt(row[3]) || 0;
        if (time) golsPorTime[time] = (golsPorTime[time] || 0) + gols;
    });
    const golsTomados = {};
    allDataSheet1.slice(1).forEach(row => {
        const mandante = row[4];
        const visitante = row[7];
        const placar1 = parseInt(row[5]) || 0;
        const placar2 = parseInt(row[6]) || 0;
        if (mandante) golsTomados[mandante] = (golsTomados[mandante] || 0) + placar2;
        if (visitante) golsTomados[visitante] = (golsTomados[visitante] || 0) + placar1;
    });
    if (filters.clube) {
        Object.keys(golsTomados).forEach(team => {
            if (team !== filters.clube) delete golsTomados[team];
        });
        Object.keys(golsPorTime).forEach(team => {
            if (team !== filters.clube) delete golsPorTime[team];
        });
    }
    const posicaoMap = {};
    allDataClassification.slice(1).forEach(row => {
        const posicao = row[1].replace('º', '');
        posicaoMap[normalizeString(row[2])] = posicao;
    });
    let sortedTeams = [];
    if (sortConfigEstatisticas.mode === 'gols') {
        sortedTeams = Object.entries(golsPorTime).sort((a, b) => b[1] - a[1]);
    } else if (sortConfigEstatisticas.mode === 'classificacao') {
        sortedTeams = Object.entries(golsPorTime).sort((a, b) => {
            const posA = parseInt(posicaoMap[normalizeString(a[0])] || '999');
            const posB = parseInt(posicaoMap[normalizeString(b[0])] || '999');
            return posA - posB;
        });
    }
    const labelsGols = sortedTeams.map(([team]) => {
        const posicao = posicaoMap[normalizeString(team)] || 'N/A';
        return `${team} (${posicao}º)`;
    });
    const dataGols = sortedTeams.map(([_, gols]) => gols);
    const labelsTomados = labelsGols;
    const dataTomados = labelsGols.map(team => {
        const teamName = team.split(' (')[0];
        return golsTomados[teamName] || 0;
    });
    const mediaGols = dataGols.length > 0 ? dataGols.reduce((sum, val) => sum + val, 0) / dataGols.length : 0;
    const mediaTomados = dataTomados.length > 0 ? dataTomados.reduce((sum, val) => sum + val, 0) / dataTomados.length : 0;
    const mediaGolsData = dataGols.length > 0 ? Array(dataGols.length).fill(mediaGols) : [];
    const mediaTomadosData = dataTomados.length > 0 ? Array(dataTomados.length).fill(mediaTomados) : [];
    const tendenciaGols = calculatePolynomialRegression(dataGols, 2);
    const tendenciaTomados = calculatePolynomialRegression(dataTomados, 2);
    document.getElementById('sort-gols').classList.toggle('active-tab', sortConfigEstatisticas.mode === 'gols');
    document.getElementById('sort-classificacao').classList.toggle('active-tab', sortConfigEstatisticas.mode === 'classificacao');
    if (golsPorTimeChart) golsPorTimeChart.destroy();
    if (golsTomadosChart) golsTomadosChart.destroy();
    golsPorTimeChart = new Chart(canvasGolsPorTime, {
        type: 'bar',
        data: {
            labels: labelsGols,
            datasets: [
                {
                    label: 'Gols Feitos',
                    data: dataGols,
                    backgroundColor: '#3b82f6',
                    borderColor: '#1d4ed8',
                    borderWidth: 1
                },
                {
                    label: 'Média',
                    data: mediaGolsData,
                    type: 'line',
                    borderColor: '#15803d',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    borderDash: [5, 5]
                },
                {
                    label: 'Tendência',
                    data: tendenciaGols,
                    type: 'line',
                    borderColor: '#6b21a8',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: { padding: { bottom: 0, right: 0, left: 0, top: 25 } },
            scales: {
                y: { beginAtZero: true, title: { display: false }, ticks: { stepSize: 1, font: { size: 8 } } },
                x: { title: { display: false }, ticks: { rotation: 90, autoSkip: false, font: { size: 8 }, padding: 5, maxRotation: 90, minRotation: 90 }, grid: { display: false } }
            },
            plugins: { legend: { display: true, labels: { font: { size: 8 } } }, title: { display: false, text: 'Gols Feitos' } }
        },
        plugins: [{
            id: 'customDatalabels',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    if (dataset.type !== 'bar') return;
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            const x = bar.x;
                            const y = bar.y - 10;
                            ctx.save();
                            ctx.textAlign = 'center';
                            ctx.font = '8px Arial';
                            ctx.fillStyle = '#000';
                            ctx.fillText(value, x, y);
                            ctx.restore();
                        }
                    });
                });
            }
        }]
    });
    golsTomadosChart = new Chart(canvasGolsTomados, {
        type: 'bar',
        data: {
            labels: labelsTomados,
            datasets: [
                {
                    label: 'Gols Tomados',
                    data: dataTomados,
                    backgroundColor: '#ef4444',
                    borderColor: '#b91c1c',
                    borderWidth: 1
                },
                {
                    label: 'Média',
                    data: mediaTomadosData,
                    type: 'line',
                    borderColor: '#15803d',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    borderDash: [5, 5]
                },
                {
                    label: 'Tendência',
                    data: tendenciaTomados,
                    type: 'line',
                    borderColor: '#6b21a8',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: { padding: { bottom: 0, right: 0, left: 0, top: 25 } },
            scales: {
                y: { beginAtZero: true, title: { display: false }, ticks: { stepSize: 1, font: { size: 8 } } },
                x: { title: { display: false }, ticks: { rotation: 90, autoSkip: false, font: { size: 8 }, padding: 5, maxRotation: 90, minRotation: 90 }, grid: { display: false } }
            },
            plugins: { legend: { display: true, labels: { font: { size: 8 } } }, title: { display: false, text: 'Gols Tomados' } }
        },
        plugins: [{
            id: 'customDatalabels',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    if (dataset.type !== 'bar') return;
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            const x = bar.x;
                            const y = bar.y - 10;
                            ctx.save();
                            ctx.textAlign = 'center';
                            ctx.font = '8px Arial';
                            ctx.fillStyle = '#000';
                            ctx.fillText(value, x, y);
                            ctx.restore();
                        }
                    });
                });
            }
        }]
    });
}

function filterDataArtilharia(data, filters) {
    console.log('Aplicando filtros para artilharia:', filters);
    let filteredRows = data.slice(1).filter((row, index) => {
        if (!row || row.length < 4) {
            console.log(`Linha ${index + 2} inválida:`, row);
            return false;
        }
        const clube = filters.clube ? filters.clube.trim() : '';
        const jogador = filters.jogador ? filters.jogador.trim() : '';
        return (!clube || row[2] === clube) && (!jogador || row[1] === jogador);
    }).sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0));
    console.log('Dados filtrados e ordenados por Index:', filteredRows);
    return filteredRows;
}

function clearFilters(tabId) {
    if (tabId === 'estatisticas') {
        ['clube-estatisticas', 'jogador-estatisticas'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        displayEstatisticas();
    }
}

async function applyGlobalFilters() {
    const divisaoSelect = document.getElementById('divisao-global');
    const categoriaSelect = document.getElementById('categoria-global');
    if (!checkElement(divisaoSelect, '#divisao-global') || !checkElement(categoriaSelect, '#categoria-global')) return;
    globalFilters.divisao = divisaoSelect.value;
    globalFilters.categoria = categoriaSelect.value;
    localStorage.setItem('global_divisao', globalFilters.divisao);
    localStorage.setItem('global_categoria', globalFilters.categoria);
    console.log('Filtros globais aplicados:', globalFilters);
    allDataSheet1 = await fetchFirebaseData('jogos');
    allDataClassification = await fetchFirebaseData('classificacao');
    allDataArtilharia = await fetchFirebaseData('artilharia');
    populateFilters();
    displayEstatisticas();
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function clearGlobalFilters() {
    const divisaoSelect = document.getElementById('divisao-global');
    const categoriaSelect = document.getElementById('categoria-global');
    if (!checkElement(divisaoSelect, '#divisao-global') || !checkElement(categoriaSelect, '#categoria-global')) return;
    const divisoes = Array.from(divisaoSelect.options).map(opt => opt.value).filter(v => v !== 'Nenhuma');
    const categorias = Array.from(categoriaSelect.options).map(opt => opt.value).filter(v => v !== 'Nenhuma');
    globalFilters.divisao = divisoes.includes('A1') ? 'A1' : (divisoes.length > 0 ? divisoes[0] : 'Nenhuma');
    globalFilters.categoria = categorias.includes('Sub-7') ? 'Sub-7' : (categorias.length > 0 ? categorias[0] : 'Nenhuma');
    localStorage.setItem('global_divisao', globalFilters.divisao);
    localStorage.setItem('global_categoria', globalFilters.categoria);
    divisaoSelect.value = globalFilters.divisao;
    categoriaSelect.value = globalFilters.categoria;
    console.log('Filtros globais limpos com valores padrão:', globalFilters);
    applyGlobalFilters();
    updateSelecaoAtual();
}

async function init() {
    console.log('Inicializando aplicação');
    timesApelidos = await fetchTimesApelidos();
    await populateGlobalFilters();
    allDataSheet1 = await fetchFirebaseData('jogos');
    allDataClassification = await fetchFirebaseData('classificacao');
    allDataArtilharia = await fetchFirebaseData('artilharia');
    if (allDataSheet1.length <= 1) showError('Nenhum dado disponível no nó jogos. Verifique o caminho no Firebase.');
    if (allDataClassification.length <= 1) showError('Nenhum dado disponível no nó classificacao. Verifique o caminho no Firebase.');
    if (allDataArtilharia.length <= 1) showError('Nenhum dado disponível no nó artilharia. Verifique o caminho no Firebase.');
    populateFilters();
    document.querySelectorAll('.toggle-filters').forEach(btn => {
        btn.addEventListener('click', () => {
            const filterContent = btn.nextElementSibling;
            filterContent.classList.toggle('hidden');
            btn.textContent = filterContent.classList.contains('hidden') ? 'Abrir Filtros' : 'Fechar Filtros';
        });
    });
    const toggleSettings = document.getElementById('toggle-settings');
    if (toggleSettings) {
        toggleSettings.addEventListener('click', async () => {
            await populateGlobalFilters();
            const modal = document.getElementById('settings-modal');
            if (modal) modal.classList.toggle('hidden');
        });
    }
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.classList.add('hidden');
        });
    }
    document.getElementById('aplicarFiltros-estatisticas').addEventListener('click', displayEstatisticas);
    document.getElementById('limparFiltros-estatisticas').addEventListener('click', () => clearFilters('estatisticas'));
    document.getElementById('sort-gols').addEventListener('click', () => {
        sortConfigEstatisticas.mode = 'gols';
        displayEstatisticas();
    });
    document.getElementById('sort-classificacao').addEventListener('click', () => {
        sortConfigEstatisticas.mode = 'classificacao';
        displayEstatisticas();
    });
    document.getElementById('aplicarFiltros-global').addEventListener('click', applyGlobalFilters);
    document.getElementById('limparFiltros-global').addEventListener('click', clearGlobalFilters);
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
        try {
            await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registrado');
        } catch (error) {
            console.error('Erro ao registrar Service Worker:', error);
        }
    }
    showTab('estatisticas');
}

function showTab(tabId) {
    console.log(`Trocando para aba ${tabId}`);
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active-tab'));
    const activeTab = document.getElementById(tabId);
    if (activeTab) activeTab.classList.add('active');
    const activeButton = document.getElementById(`${tabId}-btn`);
    if (activeButton) activeButton.classList.add('active-tab');
    if (tabId === 'estatisticas') displayEstatisticas();
}

document.addEventListener('DOMContentLoaded', init);