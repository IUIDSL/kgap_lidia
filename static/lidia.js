// global variables

// Input variables
var indication, atc;
// DrugCentral response
var disease_list, drug_list, cdi_list;
// KG response
var gene_list, gene_table;
// Evidence path variables
var chosen_gene, cy_evidence_path;


$(document).ready(fetch('indications.json')
    .then(response => response.json())
    .then(data => $("#indication-input").autocomplete({ source: data })))

function about() {
    $('#about-button').fadeOut(100, function () { $('#about-text').fadeIn('slow') })
}

function start() {
    $('#introduction').fadeOut('slow', function () { $('#input').fadeIn('slow') });
}

function output() {
    $('#input').fadeOut('slow', function () { $('#output').fadeIn('slow', function () { gene_table.draw() }) });
}

function processDrugs(data) {
    // retrieved diseases
    disease_list = data.disease_list
    // retrieved drugs
    drug_list = data.drug_list

    // build pubchem cid list for the next query
    cid_list = []

    for (drug of drug_list) {
        cid_list.push(drug.pubchem_cid)
    }

    $('#output-text').append('<p>' + disease_list + '</p>')

    return cid_list
}

function run() {

    $('#run-button').addClass('loader');

    // update global variables
    indication = document.getElementById("indication-input").value
    atc = document.getElementById("atc-input").value

    // fetch drug list
    let formData = new FormData(document.getElementById("input-form"));
    //formData.append('indication', indication);
    //formData.append('atc', atc);

    fetch('drugs.json', { body: formData, method: "post" })
        .then(response => response.json())
        .then(data => processDrugs(data))
        .then(cid_list => getGenes(cid_list))
        .then(data => output(data))

    return false
}

function processGenes(data) {

    let columns = [
        { data: 'geneSymbol', title: 'Symbol', searchable: true, orderable: false },
        { data: 'TDL', title: 'TDL', orderable: false },
        { data: 'kgapScore', title: 'score', searchable: false, orderable: true }
    ]

    gene_list = data;

    gene_table = $('#gene-table').DataTable({
        data: data,
        dom: 'lrtip',
        columns: columns,
        lengthChange: false,
        searching: true,
        paging: false,
        scrollCollapse: true,
        scrollY: "400px",
        order: [[2, 'desc']],
        fixedHeader: {
            header: true,
            footer: true
        },
        initComplete: function () {

            var column = this.api().column(0)

            $(column.header()).empty().append('<input type="text" class="u-full-width" placeholder="Gene symbol">')

            $('input', column.header()).on('keyup change clear', function () {
                gene_table.column(0).search(this.value).draw();

            });

            //TDL column
            column = this.api().column(1)
            var select = $('<select><option value="">TDL</option></select>')
                .appendTo($(column.header()).empty())
                .on('change', function () {
                    var val = $.fn.dataTable.util.escapeRegex(
                        $(this).val()
                    );

                    column
                        .search(val ? '^' + val + '$' : '', true, false)
                        .draw();
                });

            column.data().unique().sort().each(function (d, j) {
                select.append('<option value="' + d + '">' + d + '</option>')
            });
            this.api().draw();
        }

    });


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

}


function getGenes() {
    if (cid_list.length == 0) {
        console.log('no drugs came up for the query')
        return undefined
    }

    let formData = new FormData();
    formData.append('cid_list', cid_list);

    return fetch('genes.json', { body: formData, method: "post" })
        .then(response => response.json())
        .then(data => processGenes(data))
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

function reset() {
    $('#output').fadeOut('slow');

    // reset global variables
    indication = undefined;
    atc = undefined;
    disease_list = undefined;
    drug_list = undefined;
    cdi_list = undefined;
    gene_list = undefined;
    chosen_gene = undefined;

    // cy_evidence_path;
    $('#run-button').removeClass('loader');

    try {
        gene_table.destroy();
    }
    finally {
        $('#output-text').empty();
        $('#gene-table').empty();
        $('#input-form')[0].reset();

        $('#input').fadeIn('slow');
    }
}