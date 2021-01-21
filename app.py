import sys, os, re, logging, argparse, json
import pandas as pd
import numpy as np
import psycopg2, psycopg2.extras, neo4j
from flask import Flask, render_template, request, url_for


### Parse DB cradentials
with open("neo.json") as f:
    neo4j_params = json.load(f)
    neo4j_params["auth"] = (neo4j_params.pop("user"), neo4j_params.pop("password"))

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

### What if these sessions expire?
dbcon = DrugCentralConnect()
session = Neo4jConnect()

### This is the main page
@app.route("/")
def landing():
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

    session = Neo4jConnect()

    cql = f"match p=(n:Drug)-[]-(s:Signature)-[sg]-(gd:Gene {{name:'{gene}'}}) where n.pubchem_cid in {cid_list} return p"

    print(cql)

    g = session.run(cql).graph()

    graph = []

    for node in g.nodes:

        n = dict(node)
        n["id"] = node.id

        if "sig_id" in n:
            n["level"] = 2
        elif "pubchem_cid" in n:
            n["level"] = 1
        else:
            n["level"] = 3

        graph.append(dict(data=n))

    for edge in g.relationships:

        n1 = edge.nodes[0].id
        n2 = edge.nodes[1].id
        e = dict(data=dict(id=f"{n1}-{n2}", source=n1, target=n2))
        graph.append(e)

    with open(f"tmp/{gene}_evidence_path.json", "w") as f:
        json.dump(graph, f)
    return json.dumps(graph)


### Run the app (not for production)
if __name__ == "__main__":
    app.run(debug=True)
