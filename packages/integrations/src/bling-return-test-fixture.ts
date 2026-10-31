// Synthetic XML for tests only. Never uploaded or used as fiscal evidence.
export const returnTestKey = "1".repeat(44);
export const returnTestXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${returnTestKey}" versao="4.00">
<ide><tpAmb>2</tpAmb><tpNF>1</tpNF><finNFe>1</finNFe><indFinal>1</indFinal></ide>
<dest><CPF>00000000000</CPF><indIEDest>9</indIEDest><enderDest><UF>SP</UF></enderDest></dest>
<det nItem="1"><prod><cProd>TEST-PAIR</cProd><xProd>Synthetic pair &amp; test</xProd><NCM>64022000</NCM>
<uCom>PR</uCom><qCom>2.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>20.00</vProd><indTot>1</indTot>
<vDesc>10.00</vDesc><vFrete>2.00</vFrete><vOutro>0.00</vOutro></prod>
<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
<total><ICMSTot><vProd>20.00</vProd><vFrete>2.00</vFrete><vDesc>10.00</vDesc><vOutro>0.00</vOutro><vNF>12.00</vNF></ICMSTot></total>
</infNFe></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${returnTestKey}</chNFe><cStat>100</cStat><nProt>000000000000001</nProt></infProt></protNFe></nfeProc>`;
