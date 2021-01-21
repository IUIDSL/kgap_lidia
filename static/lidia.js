// global variables

var indication;
var atc;
var disease_list;
var drug_list;
var cid_list;
var gene_list;
var drug_table;
var gene_table;
var indication_list;


$(document).ready( fetch('http://localhost:5000/indications.json')
        .then(response => response.json()).then(data => $("#indication-input").autocomplete({ source: data })) )

function processDrugs(data) {
    disease_list = data.disease_list
    drug_list = data.drug_list

    // update cid_list for the next step
    cid_list = []

    for (drug of drug_list) {
        cid_list.push(drug.pubchem_cid)
    }

    if (drug_table) {
        drug_table.destroy()
    }

    let columns = [{ data: 'pubchem_cid' }, { data: 'name' }]

    drug_table = $('#drug-table').DataTable({
        data: data['drug_list'],
        columns: columns,
        lengthChange: false,
        searching: false
    })

}

function getDrugs() {

    // update global variables
    indication = document.getElementById("indication-input").value
    atc = document.getElementById("atc-input").value

    // fetch drug list
    let formData = new FormData();
    formData.append('indication', indication);
    formData.append('atc', atc);

    fetch('http://localhost:5000/drugs.json', {
        body: formData,
        method: "post"
    })
        .then(response => response.json()).then(data => processDrugs(data)).then(data => getGenes())
    //   .then(response => response.json()).then(data => (console.log(data) )
}

function processGenes(data) {

    let columns = [{ data: 'geneSymbol' }, { data: 'TDL' }]

    gene_list = data;

    gene_table = $('#gene-table').DataTable({
        data: data,
        columns: columns,
        lengthChange: false,
        searching: false
    })

    getEvidencePath();
}

function getGenes() {

    console.log(cid_list)
    let formData = new FormData();
    formData.append('cid_list', cid_list);

    fetch('http://localhost:5000/genes.json', {
        body: formData,
        method: "post"
    }).then(response => response.json()).then(data => processGenes(data))

}

function getEvidencePath() {

    let formData = new FormData();
    formData.append('indication', indication);
    formData.append('atc', atc);
    formData.append('gene', 'SYNGR3');

    fetch('http://localhost:5000/evidence_path.json', {
        body: formData,
        method: "post"
    })
        .then(response => response.json())
        .then(data => cytoscape({
            container: document.getElementById('cy'),
            layout: {
                name: 'concentric', concentric: function (node) { return node.data('level'); },
                levelWidth: function (nodes) {
                    return 1;
                }
            },
            elements: data
        }));
}

function runLidia() {
    getDrugs()
    getGenes()
}