// Inputs
var indication, atc;
// DrugCentral response
var disease_list, drug_list, cid_list;
// KG response
var gene_list, gene_table;
// Evidence path variables
var chosen_gene, cy_evidence_path;

$(document).ready(fetch('indications.json')
    .then(response => response.json())
    .then(data => $("#indication-input").autocomplete({
        source: data
    })))

function about() {
    $('#about-button').fadeOut(50, function() {
        $('#about-text').fadeIn('slow')
    })
}

function start() {
    $('#introduction').fadeOut('slow', function() {
        $('#input').fadeIn('slow')
    });
}

function output() {
    $('#input').fadeOut('slow', function() {
        $('#output').fadeIn('slow', function() {
            renderEvidenceBackbone(20, 50);
            gene_table.draw();
        })
    });
}

function reset() {
    $('#output').fadeOut('slow', function() {
        $('#input').fadeIn('slow')
    });

    // reset global variables
    indication = undefined;
    atc = undefined;
    disease_list = undefined;
    drug_list = undefined;
    cid_list = undefined;
    gene_list = undefined;
    chosen_gene = undefined;

    $('#run-button').removeClass('loader');
    $('#gene-table').off('click');

    try {
        gene_table.destroy();
        cy_evidence_path.destroy();
    } finally {
        $('#output-text').empty();
        $('#gene-table').empty();
        $('#input-form')[0].reset();
    }
}

function processDrugs(data) {
    // retrieved diseases
    disease_list = data.disease_list
    // retrieved drugs
    drug_list = data.drug_list

    // build pubchem cid list for the next query
    cid_list = []

    for (drug of drug_list) {
        cid_list.push(drug.id)
    }
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

    fetch('drugs.json', {
            body: formData,
            method: "post"
        })
        .then(response => response.json())
        .then(processDrugs)
        .then(getGenes)

}

function processGenes(data) {

    let columns = [{
            data: 'geneSymbol',
            title: 'Symbol',
            searchable: true,
            orderable: false
        },
        {
            data: 'TDL',
            title: 'TDL',
            orderable: false
        },
        {
            data: 'sign',
            title: 'sign',
            orderable: true
        },
        {
            data: 'absScore',
            title: 'score',
            searchable: false,
            orderable: true
        }
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
        scrollY: "500px",
        order: [
            [3, 'desc']
        ],
        initComplete: function() {

            var column = this.api().column(0)

            $(column.header()).empty().append('<input type="text" class="u-full-width" placeholder="Gene">')

            $('input', column.header()).on('keyup change clear', function() {
                gene_table.column(0).search(this.value).draw();

            });

            //TDL column
            column = this.api().column(1)
            var select = $('<select><option value="">TDL</option></select>')
                .appendTo($(column.header()).empty())
                .on('change', function() {
                    var val = $.fn.dataTable.util.escapeRegex(
                        $(this).val()
                    );

                    column
                        .search(val ? '^' + val + '$' : '', true, false)
                        .draw();
                });

            column.data().unique().sort().each(function(d, j) {
                select.append('<option value="' + d + '">' + d + '</option>')
            });
            this.api().draw();
        }

    });

    $('#gene-table').on('click', 'tr', function() {
        if ($(this).hasClass('selected')) {
            $(this).removeClass('selected');
            chosen_gene = undefined
        } else {
            gene_table.$('tr.selected').removeClass('selected');
            $(this).addClass('selected');
            chosen_gene = gene_table.row('.selected').data().geneSymbol
            console.log(chosen_gene);
            renderEvidenceEdges(chosen_gene);
        }
    });
}

function getGenes() {
    if (cid_list.length == 0) {
        console.log('no drugs came up for the query')
        return undefined
    }

    let formData = new FormData();
    formData.append('cid_list', JSON.stringify(cid_list.map(Number)));

    fetch('genes.json', {
            body: formData,
            method: "post"
        })
        .then(response => response.json())
        .then(data => processGenes(data))
        .then(summary_text)
        .then(output);
}

function summary_text() {

    let summary = `<p> Query <strong>${indication}</strong> `

    if (atc) {
        summary += `with ATC filter <strong>${atc}</strong> `
    }
    summary += 'matched <span class="tooltip"> <strong>' +
        disease_list.length +
        '</strong> indications <span class="tooltiptext">';
    for (disease of disease_list) {
        summary += disease + '<br/>';
    }
    summary += '</span> </span> <br/>' +
        'which yielded <span class="tooltip"><strong>' +
        drug_list.length +
        '</strong> drugs <span class="tooltiptext">';
    for (drug of drug_list) {
        summary += drug.name + '<br/>';
    }
    summary += '</span> </span> and <strong>' +
        gene_list.length +
        '</strong> potential targets. </p>'

    $('#output-text').append(summary)
}

//// GRAPH FUNCTIONS ////

function renderEvidenceBackbone(min_diameter, max_diameter) {

    // style object could be moved outside.
    s = [{
            selector: "node",
            style: {
                "label": "data(name)",
                "font-size": 12,
                "width": "data(diameter)",
                "height": "data(diameter)",
                "text-valign": "center",
                "text-halign": "center"
            }
        },
        {
            selector: "node[level=1]",
            style: {
                "background-color": "#99ccff"
            }
        },
        {
            selector: "node[level=2]",
            style: {
                "background-color": "red"
            }
        },
        {
            "selector": "edge",
            "style": {
                "width": 2,
                //   "curve-style": "haystack",
                //   "haystack-radius": 0.5
                "curve-style": "bezier",
                "control-point-step-size": 5
            },
        }
    ]

    nodes = [];
    for (drug of drug_list) {
        drug['level'] = 1;
        drug['diameter'] = min_diameter + (drug.gene_scale * (max_diameter - min_diameter));
        nodes.push({
            data: drug
        });
    }

    cy_evidence_path = cytoscape({
        container: document.getElementById('cy'),
        layout: {
            name: 'circle',
            radius: 275,
            fit: true,
            //  nodeDimensionsIncludeLabels: true
        },
        elements: {
            nodes: nodes
        },
        style: s
    })
}

function renderEvidenceEdges(gene) {

    let formData = new FormData();
    formData.append('gene', gene);
    formData.append('cid_list', JSON.stringify(cid_list.map(Number)));

    cy_evidence_path.$('node[level = 2 ]').remove()
    //cy_evidence_path.edges().remove();

    graph_size = cy_evidence_path.size()

    // add center node
    cy_evidence_path.add({
        group: 'nodes',
        data: {
            id: gene,
            diameter: 50,
            name: gene,
            level: 2
        },
        class: 'gene',
        // put it in the actual center
        position: {
            x: graph_size.width / 2,
            y: graph_size.height / 2
        }
    })

    fetch('edges.json', {
            body: formData,
            method: "post"
        })
        .then(response => response.json())
        .then(edges => cy_evidence_path.add({
            edges: edges
        }));
}