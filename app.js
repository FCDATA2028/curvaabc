// Credenciales Supabase
const SUPABASE_URL = "https://qaxxggokkclsfsjfmtbs.supabase.co";
const SUPABASE_KEY = "sb_publishable_xbiL5biH5Y9jUf9wfM-7Fg_C2TqshKs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let rawRows = [];
let skuMap = {}; // Diccionario para agrupar las 4 ventanas de tiempo de cada SKU
let chartEvolucionInstance = null;
let chartClaseInstance = null;

// Jerarquía de Curvas para calcular Subidas/Caídas de Slotting
const CURVA_RANK = {
    'A1F': 1, 'A1S': 1,
    'A2F': 2, 'A2S': 2,
    'B1F': 3, 'B1S': 3,
    'B2S': 4,
    'C1S': 5,
    'C2S': 6
};

// Limpieza y estandarización del campo 'tiempo'
function parseTiempo(val) {
    if (!val) return "OTRO";
    const str = val.toString().toLowerCase();
    if (str.includes("1") && str.includes("6")) return "1.5Y";
    if (str.includes("1") && str.includes("a")) return "1Y";
    if (str.includes("6")) return "6M";
    if (str.includes("3")) return "3M";
    return "OTRO";
}

// Cargar todos los registros desde Supabase
async function fetchData() {
    const statusEl = document.getElementById("dbStatus");
    try {
        statusEl.innerText = "Cargando datos relacionales...";

        // Paginación para traer todo el histórico de la DB
        let allData = [];
        let page = 0;
        const pageSize = 10000;
        let keepFetching = true;

        while (keepFetching && page < 7) { // Cargar hasta 70k registros
            const { data, error } = await supabaseClient
                .from('curvas_picking')
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;
            if (data.length === 0) keepFetching = false;
            else {
                allData = allData.concat(data);
                page++;
            }
        }

        rawRows = allData;
        statusEl.innerText = "🟢 Conectado OK";
        statusEl.classList.add("text-emerald-600");

        processDataAndRender();
    } catch (err) {
        console.error("Error cargando Supabase:", err);
        statusEl.innerText = "🔴 Error de Conexión";
    }
}

// Agrupar filas sueltas por SKU y calcular Estado de Slotting
function processDataAndRender() {
    skuMap = {};

    // 1. Agrupar la información de cada SKU en las distintas ventanas de tiempo
    rawRows.forEach(row => {
        const sku = row.sku;
        if (!sku) return;

        const tNorm = parseTiempo(row.tiempo);

        if (!skuMap[sku]) {
            skuMap[sku] = {
                sku: sku,
                descripcion: row.descripcion || '',
                clase: (row.clase || '').toLowerCase().includes('farmacia') ? 'Farmacia' : 'Sala',
                times: {}
            };
        }

        skuMap[sku].times[tNorm] = row.curva_oficial || row.curva;
    });

    const totalUnicos = Object.keys(skuMap).length;
    document.getElementById("totalSkus").innerText = totalUnicos.toLocaleString() + " SKUs Únicos";

    // 2. Procesar Métricas comparando 1Y vs 3M
    let activos3M = 0;
    let upgrades = 0;
    let downgrades = 0;
    let estables = 0;
    let inactivos = 0;

    const tableList = [];

    Object.values(skuMap).forEach(item => {
        const c1Y = item.times['1Y'];
        const c3M = item.times['3M'];

        if (c3M) activos3M++;

        let estado = 'ESTABLE';

        if (c1Y && !c3M) {
            estado = 'INACTIVO';
            inactivos++;
        } else if (c1Y && c3M) {
            const rank1Y = CURVA_RANK[c1Y] || 99;
            const rank3M = CURVA_RANK[c3M] || 99;

            if (rank3M < rank1Y) {
                estado = 'UPGRADE'; // Subió de curva (Aceleración)
                upgrades++;
            } else if (rank3M > rank1Y) {
                estado = 'DOWNGRADE'; // Bajó de curva (Desaceleración)
                downgrades++;
            } else {
                estables++;
            }
        }

        item.estado = estado;
        tableList.push(item);
    });

    // 3. Renderizar KPIs idénticos a la 2da Imagen
    document.getElementById("kpiTotal").innerText = `${((activos3M / totalUnicos) * 100).toFixed(1)}%`;
    document.getElementById("kpiFarmacia").innerText = `${((upgrades / activos3M) * 100).toFixed(1)}%`;
    document.getElementById("kpiSala").innerText = `${((downgrades / activos3M) * 100).toFixed(1)}%`;
    document.getElementById("kpiTopCurva").innerText = `${((estables / activos3M) * 100).toFixed(1)}%`;

    renderTable(tableList);
    renderCharts();
}

// Tabla con el cruce de tiempos por SKU
function renderTable(data) {
    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    const display = data.slice(0, 100); // Primeros 100 para fluidez

    display.forEach(item => {
        let badgeClass = "bg-slate-100 text-slate-700";
        if (item.estado === 'UPGRADE') badgeClass = "bg-emerald-100 text-emerald-800";
        if (item.estado === 'DOWNGRADE') badgeClass = "bg-rose-100 text-rose-800";
        if (item.estado === 'INACTIVO') badgeClass = "bg-amber-100 text-amber-800";

        const row = `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="py-3 px-4 font-mono text-xs font-bold">${item.sku}</td>
                <td class="py-3 px-4 text-xs">${item.descripcion}</td>
                <td class="py-3 px-4 text-xs font-semibold">${item.clase}</td>
                <td class="py-3 px-4 text-xs font-bold text-slate-500">${item.times['1Y'] || '0 Hits'}</td>
                <td class="py-3 px-4 text-xs font-bold text-farmacorp-red">${item.times['3M'] || '0 Hits'}</td>
                <td class="py-3 px-4 text-center"><span class="px-2 py-1 rounded text-xs font-bold ${badgeClass}">${item.estado}</span></td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// Gráficos de Evolución y Distribución por Clase
function renderCharts() {
    // Conteos por tiempo y clase
    const counts = {
        '1.5Y': { Sala: 0, Farmacia: 0 },
        '1Y': { Sala: 0, Farmacia: 0 },
        '6M': { Sala: 0, Farmacia: 0 },
        '3M': { Sala: 0, Farmacia: 0 }
    };

    Object.values(skuMap).forEach(item => {
        ['1.5Y', '1Y', '6M', '3M'].forEach(t => {
            if (item.times[t]) {
                counts[t][item.clase]++;
            }
        });
    });

    // 1. Gráfico de Evolución de SKUs Activos por Ventana Temporal
    if (chartEvolucionInstance) chartEvolucionInstance.destroy();
    const ctxEvo = document.getElementById('chartCurvas').getContext('2d');
    chartEvolucionInstance = new Chart(ctxEvo, {
        type: 'bar',
        data: {
            labels: ['1.5 Años', '1 Año', '6 Meses', '3 Meses'],
            datasets: [
                {
                    label: 'Sala',
                    data: [counts['1.5Y'].Sala, counts['1Y'].Sala, counts['6M'].Sala, counts['3M'].Sala],
                    backgroundColor: '#E30613'
                },
                {
                    label: 'Farmacia',
                    data: [counts['1.5Y'].Farmacia, counts['1Y'].Farmacia, counts['6M'].Farmacia, counts['3M'].Farmacia],
                    backgroundColor: '#1E293B'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { stacked: true }, y: { stacked: true } }
        }
    });

    // 2. Gráfico Donut de Clase (3M)
    if (chartClaseInstance) chartClaseInstance.destroy();
    const ctxClase = document.getElementById('chartClase').getContext('2d');
    chartClaseInstance = new Chart(ctxClase, {
        type: 'doughnut',
        data: {
            labels: [`Sala (${counts['3M'].Sala})`, `Farmacia (${counts['3M'].Farmacia})`],
            datasets: [{
                data: [counts['3M'].Sala, counts['3M'].Farmacia],
                backgroundColor: ['#E30613', '#1E293B']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// Iniciar carga
fetchData();