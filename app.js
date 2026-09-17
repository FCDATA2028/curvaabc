// Credenciales Supabase
const SUPABASE_URL = "https://qaxxggokkclsfsjfmtbs.supabase.co";
const SUPABASE_KEY = "sb_publishable_xbiL5biH5Y9jUf9wfM-7Fg_C2TqshKs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let rawRows = [];
let skuMap = {};
let chartEvolucionInstance = null;
let chartClaseInstance = null;
let chartCurvasComparativaInstance = null;

// Jerarquía de Curvas para medir la rotación (menor número = mayor frecuencia de picking)
const CURVA_RANK = {
    'A1F': 1, 'A1S': 1,
    'A2F': 2, 'A2S': 2,
    'B1F': 3, 'B1S': 3,
    'B2S': 4,
    'C1S': 5,
    'C2S': 6
};

// Estandarización de la ventana temporal adaptada a los valores reales de Supabase (ej. 18, 12, 6, 3)
function parseTiempo(val) {
    if (val === null || val === undefined) return "OTRO";
    const str = val.toString().toLowerCase().trim();
    
    if (str === "18" || str.includes("1.5") || (str.includes("1") && str.includes("6"))) return "1.5Y";
    if (str === "12" || str === "1" || str.includes("1 año") || str === "1y") return "1Y";
    if (str === "6" || str.includes("6m") || str.includes("6 meses")) return "6M";
    if (str === "3" || str.includes("3m") || str.includes("3 meses")) return "3M";
    
    return "OTRO";
}

// Cargar TODOS los registros desde la tabla public.curvas_picking sin límite de páginas
async function fetchData() {
    const statusEl = document.getElementById("dbStatus");
    try {
        statusEl.innerText = "Sincronizando con Supabase (Carga total)...";

        let allData = [];
        let page = 0;
        const pageSize = 1000;
        let keepFetching = true;

        while (keepFetching) {
            const { data, error } = await supabaseClient
                .from('curvas_picking')
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;
            
            if (!data || data.length === 0) {
                keepFetching = false;
            } else {
                allData = allData.concat(data);
                statusEl.innerText = `Sincronizando: ${allData.length.toLocaleString()} filas leídas...`;
                if (data.length < pageSize) {
                    keepFetching = false;
                } else {
                    page++;
                }
            }
        }

        rawRows = allData;
        statusEl.innerText = `🟢 Conectado OK (${rawRows.length.toLocaleString()} filas)`;
        statusEl.classList.add("text-emerald-600");

        processDataAndRender();
        setupEventListeners();
    } catch (err) {
        console.error("Error cargando Supabase:", err);
        statusEl.innerText = "🔴 Error de Conexión";
    }
}

function setupEventListeners() {
    document.getElementById("searchInput").addEventListener("input", filterAndRenderTable);
    document.getElementById("statusFilter").addEventListener("change", filterAndRenderTable);
    document.getElementById("claseFilter").addEventListener("change", () => {
        filterAndRenderTable();
        renderCharts();
    });
    document.getElementById("curva1YFilter").addEventListener("change", () => {
        filterAndRenderTable();
        renderCharts();
    });
}

// Procesar datos y unificar por SKU cruzando las ventanas temporales
function processDataAndRender() {
    skuMap = {};

    rawRows.forEach(row => {
        const sku = String(row.sku || '').trim();
        if (!sku) return;

        const tNorm = parseTiempo(row.tiempo);

        if (!skuMap[sku]) {
            skuMap[sku] = {
                sku: sku,
                descripcion: row.descripcion || '',
                clase: row.clase ? String(row.clase).trim() : 'Sala',
                rankingAnterior: row.ranking !== undefined && row.ranking !== null ? row.ranking : '-',
                times: {}
            };
        }

        if (row.clase && skuMap[sku].clase === 'Sala' && String(row.clase).trim() !== '') {
            skuMap[sku].clase = String(row.clase).trim();
        }

        if (tNorm === '1.5Y') skuMap[sku].times['1.5Y'] = row.curva_oficial || row.curva;
        else if (tNorm === '1Y') skuMap[sku].times['1Y'] = row.curva_oficial || row.curva;
        else if (tNorm === '6M') skuMap[sku].times['6M'] = row.curva_oficial || row.curva;
        else if (tNorm === '3M') skuMap[sku].times['3M'] = row.curva_oficial || row.curva;
    });

    const universoUnicos = Object.keys(skuMap).length;
    document.getElementById("universoUnicos").innerText = `${universoUnicos.toLocaleString()} SKUs Únicos`;

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
        let impactoLabel = 'Estable';
        let recomendacion = 'Mantener en Ubicación Actual';

        if (c1Y && !c3M) {
            estado = 'INACTIVO';
            impactoLabel = 'Inactivo Reciente';
            recomendacion = 'Reubicar a Zona de Stock Muerto';
            inactivos++;
        } else if (c1Y && c3M) {
            const rank1Y = CURVA_RANK[c1Y] || 99;
            const rank3M = CURVA_RANK[c3M] || 99;

            if (rank3M < rank1Y) {
                estado = 'UPGRADE';
                impactoLabel = 'Aceleración';
                recomendacion = rank3M === 1 ? 'Reubicar a Cabecera A1 (Urgente)' : 'Mover a Nivel de Cintura en Pasillo Principal';
                upgrades++;
            } else if (rank3M > rank1Y) {
                estado = 'DOWNGRADE';
                impactoLabel = 'Caída';
                recomendacion = 'Relocalizar a Rack Superior (Liberar Zona Prime)';
                downgrades++;
            } else {
                estables++;
            }
        }

        item.estado = estado;
        item.impactoLabel = impactoLabel;
        item.recomendacion = recomendacion;
        tableList.push(item);
    });

    const pctActivos = universoUnicos > 0 ? ((activos3M / universoUnicos) * 100).toFixed(1) : '0.0';
    const pctUpgrades = activos3M > 0 ? ((upgrades / activos3M) * 100).toFixed(1) : '0.0';
    const pctDowngrades = activos3M > 0 ? ((downgrades / activos3M) * 100).toFixed(1) : '0.0';
    const pctEstables = activos3M > 0 ? ((estables / activos3M) * 100).toFixed(1) : '0.0';
    const pctInactivos = universoUnicos > 0 ? ((inactivos / universoUnicos) * 100).toFixed(1) : '0.0';

    document.getElementById("kpiActivosPct").innerText = `${pctActivos}%`;
    document.getElementById("kpiActivosSub").innerText = `${activos3M.toLocaleString()}`;

    document.getElementById("kpiUpgradePct").innerText = `${pctUpgrades}%`;
    document.getElementById("kpiUpgradeSub").innerText = `↑ ${upgrades.toLocaleString()}`;

    document.getElementById("kpiDowngradePct").innerText = `${pctDowngrades}%`;
    document.getElementById("kpiDowngradeSub").innerText = `↓ ${downgrades.toLocaleString()}`;

    document.getElementById("kpiEstablesPct").innerText = `${pctEstables}%`;
    document.getElementById("kpiEstablesSub").innerText = `= ${estables.toLocaleString()}`;

    document.getElementById("kpiInactivosPct").innerText = `${pctInactivos}%`;
    document.getElementById("kpiInactivosSub").innerText = inactivos.toLocaleString();

    window.globalTableData = tableList;
    filterAndRenderTable();
    renderCharts();
}

// Obtener datos filtrados según los selectores globales
function getFilteredItems() {
    const searchVal = document.getElementById("searchInput").value.toLowerCase().trim();
    const statusVal = document.getElementById("statusFilter").value;
    const claseVal = document.getElementById("claseFilter").value;
    const curva1YVal = document.getElementById("curva1YFilter").value;

    return window.globalTableData.filter(item => {
        const matchesSearch = !searchVal ||
            item.sku.toLowerCase().includes(searchVal) ||
            item.descripcion.toLowerCase().includes(searchVal);

        const matchesStatus = (statusVal === 'ALL') || (item.estado === statusVal);

        const esFarmacia = item.clase.toLowerCase().includes('farmacia');
        const matchesClase = (claseVal === 'ALL') || 
                             (claseVal === 'Farmacia' && esFarmacia) || 
                             (claseVal === 'Sala' && !esFarmacia);

        const c1Y = (item.times['1Y'] || '').toUpperCase();
        const letraCurva1Y = c1Y.charAt(0); // Extrae 'A', 'B' o 'C'
        const matchesCurva1Y = (curva1YVal === 'ALL') || (letraCurva1Y === curva1YVal);

        return matchesSearch && matchesStatus && matchesClase && matchesCurva1Y;
    });
}

// Filtrar y renderizar tabla interactiva
function filterAndRenderTable() {
    let filtered = getFilteredItems();

    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    const display = filtered.slice(0, 100);

    if (display.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">No se encontraron registros coincidentes.</td></tr>`;
        return;
    }

    display.forEach(item => {
        let badgeClass = "bg-slate-100 text-slate-700 border border-slate-200";
        if (item.estado === 'UPGRADE') badgeClass = "bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold";
        if (item.estado === 'DOWNGRADE') badgeClass = "bg-rose-50 text-rose-700 border border-rose-200 font-bold";
        if (item.estado === 'INACTIVO') badgeClass = "bg-amber-50 text-amber-700 border border-amber-200";

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 border-b border-slate-100 text-xs";
        tr.innerHTML = `
            <td class="py-3 px-4 font-mono font-bold text-slate-800">${item.sku}</td>
            <td class="py-3 px-4 text-slate-600">${item.descripcion}</td>
            <td class="py-3 px-4"><span class="px-2 py-1 bg-slate-100 rounded text-slate-700 font-semibold">${item.clase}</span></td>
            <td class="py-3 px-4 font-mono font-bold text-slate-600 text-center">${item.rankingAnterior}</td>
            <td class="py-3 px-4 font-bold text-slate-500">${item.times['1Y'] || '-'}</td>
            <td class="py-3 px-4 font-bold text-farmacorp-red">${item.times['3M'] || '-'}</td>
            <td class="py-3 px-4"><span class="px-2 py-1 rounded-full text-[11px] ${badgeClass}">${item.impactoLabel}</span></td>
            <td class="py-3 px-4 text-slate-600 font-medium">${item.recomendacion}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Renderizar las 3 Gráficas con números grandes y centrados (usando ChartDataLabels)
function renderCharts() {
    let filteredItems = getFilteredItems();

    let countsEvo = {
        '1.5Y': { Sala: 0, Farmacia: 0 },
        '1Y': { Sala: 0, Farmacia: 0 },
        '6M': { Sala: 0, Farmacia: 0 },
        '3M': { Sala: 0, Farmacia: 0 }
    };

    let listaCurvas = ['A1F', 'A2F', 'A1S', 'A2S', 'B1F', 'B1S', 'B2S', 'C1S', 'C2S'];
    let cur1Y = {};
    let cur3M = {};
    listaCurvas.forEach(c => { cur1Y[c] = 0; cur3M[c] = 0; });

    let sala3M = 0;
    let farmacia3M = 0;

    filteredItems.forEach(item => {
        const esFarmacia = item.clase.toLowerCase().includes('farmacia');
        const claseKey = esFarmacia ? 'Farmacia' : 'Sala';

        ['1.5Y', '1Y', '6M', '3M'].forEach(t => {
            if (item.times[t]) {
                countsEvo[t][claseKey]++;
            }
        });

        if (item.times['3M']) {
            if (esFarmacia) farmacia3M++;
            else sala3M++;
        }

        const c1Y = item.times['1Y'];
        if (c1Y && cur1Y[c1Y] !== undefined) cur1Y[c1Y]++;

        const c3M = item.times['3M'];
        if (c3M && cur3M[c3M] !== undefined) cur3M[c3M]++;
    });

    // Configuración común para mostrar números grandes y claros dentro/encima de las barras
    const dataLabelsConfig = {
        color: '#1E293B',
        font: {
            weight: 'bold',
            size: 13
        },
        formatter: (value) => value > 0 ? value.toLocaleString() : ''
    };

    // 1. Gráfico Evolución
    if (chartEvolucionInstance) chartEvolucionInstance.destroy();
    const ctxEvo = document.getElementById('chartEvolucion').getContext('2d');
    chartEvolucionInstance = new Chart(ctxEvo, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: ['1.5 Años', '1 Año', '6 Meses', '3 Meses'],
            datasets: [
                {
                    label: 'Sala',
                    data: [countsEvo['1.5Y'].Sala, countsEvo['1Y'].Sala, countsEvo['6M'].Sala, countsEvo['3M'].Sala],
                    backgroundColor: '#E30613'
                },
                {
                    label: 'Farmacia',
                    data: [countsEvo['1.5Y'].Farmacia, countsEvo['1Y'].Farmacia, countsEvo['6M'].Farmacia, countsEvo['3M'].Farmacia],
                    backgroundColor: '#1E293B'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { stacked: true }, y: { stacked: true } },
            plugins: {
                datalabels: {
                    ...dataLabelsConfig,
                    color: '#FFFFFF' // Texto blanco dentro de las barras apiladas oscuras/rojas para contraste óptimo
                }
            }
        }
    });

    // 2. Gráfico Donut Clase (3M)
    if (chartClaseInstance) chartClaseInstance.destroy();
    const total3M = sala3M + farmacia3M || 1;
    const pctSala = ((sala3M / total3M) * 100).toFixed(1);
    const pctFarmacia = ((farmacia3M / total3M) * 100).toFixed(1);

    const ctxClase = document.getElementById('chartClase').getContext('2d');
    chartClaseInstance = new Chart(ctxClase, {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: [`Sala (${pctSala}%)`, `Farmacia (${pctFarmacia}%)`],
            datasets: [{
                data: [sala3M, farmacia3M],
                backgroundColor: ['#E30613', '#1E293B']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                datalabels: {
                    color: '#FFFFFF',
                    font: {
                        weight: 'bold',
                        size: 15
                    },
                    formatter: (value) => value > 0 ? value.toLocaleString() : ''
                }
            }
        }
    });

    // 3. Gráfico Comparativa Curvas (1 Año vs 3 Meses)
    if (chartCurvasComparativaInstance) chartCurvasComparativaInstance.destroy();
    const ctxCurvas = document.getElementById('chartCurvasComparativa').getContext('2d');
    chartCurvasComparativaInstance = new Chart(ctxCurvas, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: listaCurvas,
            datasets: [
                {
                    label: '1 Año (Acumulado)',
                    data: listaCurvas.map(c => cur1Y[c]),
                    backgroundColor: '#CBD5E1'
                },
                {
                    label: '3 Meses (Tendencia Reciente)',
                    data: listaCurvas.map(c => cur3M[c]),
                    backgroundColor: '#E30613'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { stacked: false }, y: { stacked: false } },
            plugins: {
                legend: { position: 'top' },
                datalabels: {
                    ...dataLabelsConfig,
                    anchor: 'end',
                    align: 'top',
                    color: '#1E293B',
                    font: {
                        weight: 'bold',
                        size: 12
                    }
                }
            }
        }
    });
}

// Iniciar aplicación
fetchData();
