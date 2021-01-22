import sys, os, re, logging, argparse, json
import pandas as pd
import numpy as np
import psycopg2, psycopg2.extras, neo4j
from flask import Flask, render_template, request, url_for
import networkx as nx


### Parse DB cradentials
with open("neo.json") as f:
    neo4j_params = json.load(f)
    #neo4j_params["auth"] = (neo4j_params.pop("user"), neo4j_params.pop("password"))
    neo4j_params["auth"] = (os.environ['neo4j_user'], os.environ['neo4j_pass'])

    print (neo4j_params)

###
with open("drugcentral.json") as f:
        drugcentral_params = json.load(f)

###
def Neo4jConnect(params=neo4j_params):
    """Connect to Neo4j db."""
    return neo4j.GraphDatabase.driver(**params).session()

###
def DrugCentralConnect(params=drugcentral_params):
    """Connect to DrugCentral."""
    
    dbcon = psycopg2.connect(**params)
    dbcon.cursor_factory = psycopg2.extras.DictCursor
    return dbcon

###
def cypher2df(session, cql):
    "Run Cypher query, return dataframe."
    return pd.DataFrame(session.run(cql).data())

###
def GetIndication2Drugs(dbcon, indication_query, atc_query=None):
    """Query DrugCentral from indication for drugs."""
    sql = f"""\
    SELECT DISTINCT
        ids.identifier AS pubchem_cid,
        s.id,
        s.name,
        s.smiles,
        atc.l1_code,
        atc.l1_name,
        omop.concept_name omop_concept_name,
        omop.snomed_full_name
    FROM
        omop_relationship omop
    JOIN
        structures s ON omop.struct_id = s.id
    JOIN
        identifier ids ON ids.struct_id = s.id
    LEFT JOIN
            struct2atc s2atc ON s2atc.struct_id = s.id
    LEFT JOIN
        atc ON atc.code = s2atc.atc_code
    WHERE
        ids.id_type = 'PUBCHEM_CID'
        AND omop.relationship_name = 'indication'
        AND omop.concept_name ~* %(indication)s
    """

    if atc_query:
        sql += f" AND atc.l1_name ~* %(atc)s "
        dcdrugs = pd.read_sql(sql, dbcon, params=dict(indication=indication_query, atc=atc_query))
    
    else:
        dcdrugs = pd.read_sql(sql, dbcon, params=dict(indication=indication_query))


    logging.debug(f"rows,cols: {dcdrugs.shape[0]},{dcdrugs.shape[1]}")
    return dcdrugs

### Retrieves distinct omop concept names (indication list)
def GetConceptNames(dbcon):
    sql = 'SELECT distinct omop.concept_name FROM omop_relationship omop'

    return pd.read_sql(sql, dbcon).concept_name.to_list()

##  Get unique ATC values
def GetATCvalues(dbcon):
    sql = f"""\
        SELECT DISTINCT
            atc.l1_name
        FROM
            atc
        """

    return pd.read_sql(sql, dbcon).l1_name.to_list()

### How about parameterizing cypher queries too?
def KGAP_Search(cid_list, score_attribute, session):
    cql = f"""\
    MATCH p=(d:Drug)-[]-(s:Signature)-[r]-(g:Gene), p1=(s)-[]-(c:Cell)
    WHERE (d.pubchem_cid in {cid_list})
    WITH g, {score_attribute} AS score
    RETURN g.id as ncbiGeneId, g.name as geneSymbol, g.tdl as TDL, score as kgapScore
    ORDER BY score DESC
    """
    logging.info(f"CQL: {cql}")
    cdf = cypher2df(session, cql)
    return cdf

### Globals
app = Flask(__name__)

### This is the main page
@app.route("/")
def landing():
    print(url_for("landing"))
    print(request.host_url)
    return render_template("index.html", atc_values=GetATCvalues(DrugCentralConnect()))

### Returns all distinct omop.concept_name values for autocomplete
@app.route("/indications.json") 
def indications() :
    return json.dumps(GetConceptNames(DrugCentralConnect()))

### Returns drugs for a given indication and ATC filter
@app.route("/drugs.json", methods=["POST"])
def get_drugs_by_indication():

    indication_query = request.form["indication"]
    atc_query = request.form.get("atc", None)

    print(indication_query, atc_query)

    dbcon = DrugCentralConnect()

    dcdrugs = GetIndication2Drugs(dbcon, indication_query, atc_query=atc_query)

    buffer = dict(
        disease_list=list(dcdrugs["omop_concept_name"].unique()),
        drug_list=dcdrugs[["pubchem_cid", "name", "l1_name"]].drop_duplicates(
            "pubchem_cid"
        ).to_dict(orient='records'),
    )

    return json.dumps(buffer)

### Returns all genes differentially expressed for given drugs
@app.route("/genes.json", methods=["POST"])
def get_kgap_genes():

    cid_list = request.form["cid_list"]

    #type hack, there is probably a better way to express this.
    cid_list = [int (x) for x in cid_list.split(',')]

    print(type(cid_list), cid_list)

    session = Neo4jConnect()

    # score_attribute = "sum(s.degree)"
    score_attribute = "sum(r.zscore)/sqrt(count(r))"

    cdf = KGAP_Search(cid_list, score_attribute, session)

    return cdf.to_json(orient='records')

    
@app.route("/evidence_path.json", methods=["POST"])
def getEvidencepath():

    indication_query = request.form["indication"]
    atc_query = request.form["atc"]
    gene = request.form["gene"]

    print("getting evidence path for:", indication_query, atc_query, gene)

    # Building seed drug list again
    dbcon = DrugCentralConnect()
    dcdrugs = GetIndication2Drugs(dbcon, indication_query, atc_query)
    cid_list = list(set(dcdrugs.pubchem_cid.array.astype("int")))

    print(len(cid_list))


    #cql = f"match p=(n:Drug)-[]-(s:Signature)-[sg]-(gd:Gene {{name:'{gene}'}}) where n.pubchem_cid in {cid_list} return p"
    cql = f"match p=(d:Drug)-[]-(s:Signature)-[sg]-(g:Gene {{name:'{gene}'}}) where d.pubchem_cid in {cid_list} return d,g"

    print(cql)
    
    graph = nx.Graph()

    session = Neo4jConnect()
    data = session.run(cql).data()

    for item in data :
        g = item['g']
        d = item['d']

        gene_id=int(g.pop('id'))
        drug_id=int(d.pop('id'))

        if not graph.has_node(gene_id) :
            graph.add_node(gene_id, level=2, label=g['name'], **g)

        graph.add_node(drug_id, level=1, label = d['name'], **d)

        if not graph.has_edge(gene_id, drug_id) :
            graph.add_edge(gene_id, drug_id, weight=1)
        else :
            graph[gene_id][drug_id]['weight']+=1

    response = nx.readwrite.json_graph.cytoscape.cytoscape_data(graph)

  #  with open(f"tmp/{gene}_evidence_path.json", "w") as f:
  #      json.dump(response, f)
    
    return json.dumps(response)


### Run the app (not for production)
if __name__ == "__main__":
    app.run(debug=True)