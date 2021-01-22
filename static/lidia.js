// global variables

var indication, atc;
var disease_list;
var drug_list;
var cid_list;
var gene_list;
var drug_table, gene_table;
var chosen_gene;
var cy_evidence_path;


$(document).ready(fetch('indications.json')
    .then(response => response.json())
    .then(data => $("#indication-input").autocomplete({ source: data })))


function destroyTables() {
    if (drug_table) {
        drug_table.destroy()
    }
    if (gene_table) {
        gene_table.destroy()
    }

}
function processDrugs(data) {
    disease_list = data.disease_list
    drug_list = data.drug_list

    destroyTables()
    // update cid_list for the next step
    cid_list = []

    for (drug of drug_list) {
        cid_list.push(drug.pubchem_cid)
    }

    let columns = [{ data: 'pubchem_cid', title: 'PubChem' }, { data: 'name', title: 'name' }]

    drug_table = $('#drug-table').DataTable({
        data: data['drug_list'],
        columns: columns,
        lengthChange: false,
        searching: false,
        paging: false,
        scrollCollapse: true,
        scrollY: "250px"
    })

}

function getDrugs() {

    // update global variables
    indication = document.getElementById("indication-input").value
    atc = document.getElementById("atc-input").value

    // fetch drug list
    let formData = new FormData(document.getElementById("input-form"));
    //formData.append('indication', indication);
    //formData.append('atc', atc);

    fetch('drugs.json', { body: formData, method: "post" })
        .then(response => response.json()).then(data => processDrugs(data))
        .then(data => getGenes())
    //   .then(response => response.json()).then(data => (console.log(data) )
}

function processGenes(data) {

    let columns = [{ data: 'geneSymbol', title: 'Symbol' },
    { data: 'TDL', title: 'TDL' },
    { data: 'kgapScore', title: 'score' }]

    gene_list = data;

    gene_table = $('#gene-table').DataTable({
        data: data,
        columns: columns,
        lengthChange: false,
        searching: true,
        paging: false,
        scrollCollapse: true,
        scrollY: "400px",
        order: [[2, 'desc']]
    })

    $('#gene-table').on('click', 'tr', function () {
        if ($(this).hasClass('selected')) {
            $(this).removeClass('selected');
            chosen_gene = undefined
        }
        else {
            gene_table.$('tr.selected').removeClass('selected');
            $(this).addClass('selected');
            chosen_gene = gene_table.row('.selected').data().geneSymbol
            console.log(chosen_gene);
            getEvidencePath(chosen_gene);
        }
    });

    document.getElementById('genelist').scrollIntoView({ behavior: 'smooth' })
}

function getGenes() {

    if (cid_list.length == 0) {
        return
    }

    console.log(cid_list)
    let formData = new FormData();
    formData.append('cid_list', cid_list);

    fetch('genes.json', {
        body: formData,
        method: "post"
    }).then(response => response.json()).then(data => processGenes(data))

}

function renderEvidencePath(data) {

    s = [{
        "selector": "node[label]",
        "style": {
            "label": "data(label)",
            "text-valign": "center",
            "text-halign": "center"
        }
    },
    {
        "selector": "edge",
        "style": { "width": "data(weight)" }
    }
    ]

    cy_evidence_path = cytoscape({
        container: document.getElementById('cy'),
        layout: {
            //name: 'concentric', concentric: function (node) { return node.data('level'); },
            name: 'concentric', concentric: function (node) { return node.degree(); },
            minNodeSpacing: 100,
            levelWidth: function (nodes) { return 1; }
        },
        elements: data.elements,
        style: s
    })
}

function getEvidencePath(gene) {

    let formData = new FormData();
    formData.append('indication', indication);
    formData.append('atc', atc);
    formData.append('gene', gene);

    fetch('evidence_path.json', { body: formData, method: "post" })
        .then(response => response.json())
        .then(data => renderEvidencePath(data));
}

function runLidia() {
    getDrugs()
    getGenes()
}