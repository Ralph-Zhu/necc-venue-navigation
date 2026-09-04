(function () {
  const cad = window.CAD_GEOMETRY;
  const width = 276.2;
  const depth = 125.1;

  window.VENUE_DATA = {
    building: {
      id: "building-01",
      name: "1号建筑",
      width,
      depth,
      source: "1.1号馆.dxf / 1.2号馆.dxf",
      note: "已排除294 × 207.9米CAD图框；场馆有效线稿约276.2 × 125米。"
    },
    floors: {
      F1: {
        name: "1.1号馆",
        businessName: "1.1号馆",
        elevation: 0,
        source: cad.F1.source,
        width: cad.F1.width,
        depth: cad.F1.depth,
        geometry: cad.F1,
        entrance: [138.1, 122],
        entranceConfirmed: false,
        rooms: [],
        roads: [],
        facilities: [...cad.F1.facilities, {type:"entrance", x:138.1, y:122, label:"临时入口点（待确认）"}]
      },
      F2: {
        name: "公共夹层",
        businessName: "F2预留层",
        elevation: 14,
        source: "预留位置，待补充CAD",
        width,
        depth,
        isPlaceholder: true,
        entrance: [138.1, 122],
        entranceConfirmed: false,
        rooms: [],
        roads: [],
        facilities: [
          {type:"elevator", x:6.48, y:122, label:"西侧垂直交通预留"},
          {type:"elevator", x:122.07, y:122, label:"中部垂直交通预留"},
          {type:"elevator", x:141.83, y:122, label:"中部垂直交通预留"},
          {type:"elevator", x:257.42, y:122, label:"东侧垂直交通预留"}
        ]
      },
      F3: {
        name: "1.2号馆",
        businessName: "1.2号馆",
        elevation: 28,
        source: cad.F3.source,
        width: cad.F3.width,
        depth: cad.F3.depth,
        geometry: cad.F3,
        entrance: [138.1, 123],
        entranceConfirmed: false,
        rooms: [],
        roads: [],
        facilities: [...cad.F3.facilities, {type:"entrance", x:138.1, y:123, label:"临时入口点（待确认）"}]
      }
    },
    booths: [
      {id:"b1", number:"A001", company:"未来智造", floor:"F1", x:43, y:27, w:18, h:12, color:"#21d4a7", type:"special"},
      {id:"b2", number:"A002", company:"云端科技", floor:"F1", x:65, y:27, w:15, h:12, color:"#36a3ff", type:"standard"},
      {id:"b3", number:"A003", company:"新材料实验室", floor:"F1", x:84, y:27, w:22, h:12, color:"#8b6cff", type:"special"},
      {id:"b4", number:"A004", company:"绿色能源", floor:"F1", x:150, y:27, w:17, h:12, color:"#21d4a7", type:"standard"},
      {id:"b5", number:"A005", company:"机器人产业联盟", floor:"F1", x:171, y:27, w:25, h:12, color:"#ffb547", type:"special"},
      {id:"b6", number:"A006", company:"数字城市", floor:"F1", x:60, y:70, w:24, h:17, color:"#36a3ff", type:"special"},
      {id:"b7", number:"A007", company:"智能交通", floor:"F1", x:88, y:70, w:17, h:17, color:"#21d4a7", type:"standard"},
      {id:"b8", number:"A008", company:"低空经济", floor:"F1", x:155, y:70, w:24, h:17, color:"#8b6cff", type:"special"},
      {id:"b9", number:"A009", company:"创意设计", floor:"F1", x:183, y:70, w:19, h:17, color:"#ff6577", type:"standard"},
      {id:"b10", number:"C001", company:"国际品牌馆", floor:"F3", x:44, y:32, w:29, h:17, color:"#8b6cff", type:"special"},
      {id:"b11", number:"C002", company:"东方科技", floor:"F3", x:77, y:32, w:22, h:17, color:"#21d4a7", type:"standard"},
      {id:"b12", number:"C003", company:"工业设计中心", floor:"F3", x:151, y:32, w:26, h:17, color:"#36a3ff", type:"special"},
      {id:"b13", number:"C004", company:"城市会客厅", floor:"F3", x:181, y:32, w:22, h:17, color:"#ffb547", type:"standard"},
      {id:"b14", number:"C005", company:"联合创新展区", floor:"F3", x:67, y:72, w:41, h:20, color:"#36a3ff", type:"special"},
      {id:"b15", number:"C006", company:"科技成果转化", floor:"F3", x:157, y:72, w:44, h:20, color:"#21d4a7", type:"special"}
    ]
  };
})();
