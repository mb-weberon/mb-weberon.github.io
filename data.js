var APP_DATA = {
  "scenes": [
    {
      "id": "0-front-entrance",
      "name": "Front Entrance",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -0.0793635456055739,
        "pitch": 0.03679066881946369,
        "fov": 1.5946115765331668
      },
      "linkHotspots": [
        {
          "yaw": 2.9909609325844126,
          "pitch": -0.011910310536373814,
          "rotation": 0,
          "target": "1-front-door"
        },
        {
          "yaw": 0.7823350139307443,
          "pitch": -0.2808689138489857,
          "rotation": 51.836278784231546,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "1-front-door",
      "name": "Front Door",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.6256853885934142,
        "pitch": -0.010068512938822494,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.30054102683944,
          "pitch": 0.031328864091726416,
          "rotation": 7.0685834705770345,
          "target": "2-guest-bedroom"
        },
        {
          "yaw": 2.484645099895566,
          "pitch": 0.04400147230270868,
          "rotation": 1.5707963267948966,
          "target": "0-front-entrance"
        },
        {
          "yaw": 0.633744561738931,
          "pitch": -0.3045711799544115,
          "rotation": 5.497787143782138,
          "target": "5-dining"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "2-guest-bedroom",
      "name": "Guest Bedroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.7146968189202205,
        "pitch": -0.040315160729997856,
        "fov": 1.593738833837228
      },
      "linkHotspots": [
        {
          "yaw": 3.1311109250035862,
          "pitch": 0.02131712149545706,
          "rotation": 4.71238898038469,
          "target": "3-bathroom-entrance"
        },
        {
          "yaw": -0.15156381429525467,
          "pitch": 0.05543176739766764,
          "rotation": 0,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "3-bathroom-entrance",
      "name": "Bathroom Entrance",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.262481998424322,
        "pitch": -0.0038316079306852657,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 3.0238018001650717,
          "pitch": 0.015839552227363995,
          "rotation": 3.141592653589793,
          "target": "2-guest-bedroom"
        },
        {
          "yaw": -1.485235872561848,
          "pitch": -0.015366614263008671,
          "rotation": 3.141592653589793,
          "target": "4-guest-bathroom"
        },
        {
          "yaw": -3.053769563824556,
          "pitch": 0.012840560342372243,
          "rotation": 4.71238898038469,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "4-guest-bathroom",
      "name": "Guest Bathroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "pitch": 0,
        "yaw": 0,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 2.8155270570660207,
          "pitch": -0.023869854964086556,
          "rotation": 3.141592653589793,
          "target": "3-bathroom-entrance"
        },
        {
          "yaw": 0.36420321304502856,
          "pitch": -0.09516348082363635,
          "rotation": 4.71238898038469,
          "target": "3-bathroom-entrance"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "5-dining",
      "name": "Dining",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.3749064559519226,
        "pitch": 0.16532131647591086,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 0.695210024077646,
          "pitch": 0.05342522468982125,
          "rotation": 17.27875959474387,
          "target": "6-kitchen"
        },
        {
          "yaw": 2.279202736436277,
          "pitch": 0.02794620383427926,
          "rotation": 2.356194490192345,
          "target": "9-living"
        },
        {
          "yaw": 1.1696792587916445,
          "pitch": 0.8865406549915029,
          "rotation": 14.922565104551524,
          "target": "1-front-door"
        },
        {
          "yaw": -1.6406400997839725,
          "pitch": -0.14963816537478358,
          "rotation": 3.9269908169872414,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "6-kitchen",
      "name": "Kitchen",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.6521685004208155,
        "pitch": 0.10404902228917479,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.3155058671306978,
          "pitch": 0.08702025585198392,
          "rotation": 16.493361431346422,
          "target": "5-dining"
        },
        {
          "yaw": 2.1207591274134465,
          "pitch": 0.09636237862055985,
          "rotation": 10.210176124166829,
          "target": "7-toilet"
        },
        {
          "yaw": 2.3855932980815258,
          "pitch": 0.08624755644975934,
          "rotation": 10.995574287564278,
          "target": "8-laundry"
        },
        {
          "yaw": 1.0532532279644293,
          "pitch": 0.0723087809482017,
          "rotation": 5.497787143782138,
          "target": "9-living"
        },
        {
          "yaw": 1.6020541891049573,
          "pitch": 0.050811230499054005,
          "rotation": 1.5707963267948966,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "7-toilet",
      "name": "Toilet",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "pitch": 0,
        "yaw": 0,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 0.6076786825095652,
          "pitch": -0.06398972133476022,
          "rotation": 14.137166941154074,
          "target": "6-kitchen"
        },
        {
          "yaw": -0.46777523009502175,
          "pitch": 0.013183483523967254,
          "rotation": 13.351768777756625,
          "target": "8-laundry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "8-laundry",
      "name": "Laundry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 0.05869841856434732,
        "pitch": 0.16902778813571473,
        "fov": 1.593738833837228
      },
      "linkHotspots": [
        {
          "yaw": -2.9055032706057453,
          "pitch": 0.01123834916405464,
          "rotation": 0,
          "target": "7-toilet"
        },
        {
          "yaw": 2.835097346773998,
          "pitch": -0.0023356551257087688,
          "rotation": 0,
          "target": "5-dining"
        },
        {
          "yaw": 1.02055897934493,
          "pitch": 0.028778910584009054,
          "rotation": 1.5707963267948966,
          "target": "6-kitchen"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "9-living",
      "name": "Living",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -1.0515548448052776,
        "pitch": 0.0003032292453717389,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": -1.3491559586413295,
          "pitch": 0.03671720393840516,
          "rotation": 14.922565104551524,
          "target": "10-living-window"
        },
        {
          "yaw": -0.4984109325353323,
          "pitch": 0.027901407629155273,
          "rotation": 0,
          "target": "11-patio"
        },
        {
          "yaw": -0.21903772788508924,
          "pitch": 0.016108642829758324,
          "rotation": 1.5707963267948966,
          "target": "12-stairs-to-bedrooms"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "10-living-window",
      "name": "Living Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.36870416237727,
        "pitch": 0.06496646550998264,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 2.03571950603326,
          "pitch": 0.4886741120645546,
          "rotation": 10.210176124166829,
          "target": "9-living"
        },
        {
          "yaw": 1.9315847605187688,
          "pitch": 0.1846792541085982,
          "rotation": 3.141592653589793,
          "target": "5-dining"
        },
        {
          "yaw": 2.2728546436357098,
          "pitch": 0.03245274464883785,
          "rotation": 5.497787143782138,
          "target": "6-kitchen"
        },
        {
          "yaw": 0.48154920401421997,
          "pitch": -0.011209540668527751,
          "rotation": 0,
          "target": "12-stairs-to-bedrooms"
        },
        {
          "yaw": 1.6747024813353315,
          "pitch": 0.02253398641895643,
          "rotation": 10.210176124166829,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "11-patio",
      "name": "Patio",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 2.7940127396476537,
        "pitch": -0.011157579863581901,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.8650785215651862,
          "pitch": -0.02882798131117781,
          "rotation": 24.347343065320914,
          "target": "12-stairs-to-bedrooms"
        },
        {
          "yaw": 2.413460191627788,
          "pitch": 0.02929267698463711,
          "rotation": 1.5707963267948966,
          "target": "9-living"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "12-stairs-to-bedrooms",
      "name": "Stairs to Bedrooms",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -3.045445827900304,
        "pitch": -0.02280502167976195,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": -2.5682059468015446,
          "pitch": 0.0013253623562370365,
          "rotation": 7.853981633974483,
          "target": "10-living-window"
        },
        {
          "yaw": -2.185961214129982,
          "pitch": -0.014932198757641402,
          "rotation": 1.5707963267948966,
          "target": "11-patio"
        },
        {
          "yaw": 2.453448574374516,
          "pitch": -0.28765429197736125,
          "rotation": 5.497787143782138,
          "target": "13-bedrooms-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "13-bedrooms-landing",
      "name": "Bedrooms Landing",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.176817473452605,
        "pitch": 0.036693072247093284,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 0.3874366312127826,
          "pitch": -0.2420717054210737,
          "rotation": 10.210176124166829,
          "target": "14-second-bedroom-entry"
        },
        {
          "yaw": -3.0456283594252884,
          "pitch": 0.5520342926366801,
          "rotation": 0,
          "target": "12-stairs-to-bedrooms"
        },
        {
          "yaw": 3.134525869061382,
          "pitch": 0.40846296638243906,
          "rotation": 0,
          "target": "11-patio"
        },
        {
          "yaw": 2.145875423038201,
          "pitch": -0.11014996978458669,
          "rotation": 19.63495408493622,
          "target": "17-main-bedroom"
        },
        {
          "yaw": 2.1748080352304244,
          "pitch": 0.31830569475325277,
          "rotation": 8.63937979737193,
          "target": "12-stairs-to-bedrooms"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "14-second-bedroom-entry",
      "name": "Second Bedroom Entry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -1.2968153972941128,
        "pitch": 0.014577241255647522,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": -0.831320020143572,
          "pitch": -0.06956896170211735,
          "rotation": 2.356194490192345,
          "target": "15-second-bath-entry"
        },
        {
          "yaw": -2.2861279275043316,
          "pitch": -0.1413789079751453,
          "rotation": 16.493361431346422,
          "target": "13-bedrooms-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "15-second-bath-entry",
      "name": "Second Bath Entry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 0.8417746428251096,
        "pitch": 0.030243986935840184,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.494809495423067,
          "pitch": 0.007598568275184903,
          "rotation": 24.347343065320914,
          "target": "13-bedrooms-landing"
        },
        {
          "yaw": -0.10186212228890312,
          "pitch": -0.01837030870664691,
          "rotation": 4.71238898038469,
          "target": "16-second-bathroom"
        },
        {
          "yaw": 1.5958800118230023,
          "pitch": 0.08067402033294613,
          "rotation": 3.141592653589793,
          "target": "14-second-bedroom-entry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "16-second-bathroom",
      "name": "Second Bathroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.0431620172828495,
        "pitch": -0.004664065295891362,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.5373047114203864,
          "pitch": 0.021052684651456488,
          "rotation": 3.141592653589793,
          "target": "15-second-bath-entry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "17-main-bedroom",
      "name": "Main Bedroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.4290999865669782,
        "pitch": -0.0059924340853285685,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": -1.8841837086684414,
          "pitch": 0.03884830067118372,
          "rotation": 3.141592653589793,
          "target": "18-main-bed-window"
        },
        {
          "yaw": -2.965230879934788,
          "pitch": -0.0499967000798307,
          "rotation": 4.71238898038469,
          "target": "19-bath-n-closet-entry"
        },
        {
          "yaw": 1.9834745588237697,
          "pitch": 0.014416318001771344,
          "rotation": 0,
          "target": "13-bedrooms-landing"
        },
        {
          "yaw": 2.8439300095063906,
          "pitch": -0.2533616475052263,
          "rotation": 3.9269908169872414,
          "target": "13-bedrooms-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "18-main-bed-window",
      "name": "Main Bed Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 0.8385970362603601,
        "pitch": 0.013921385466424852,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 2.6363982960160595,
          "pitch": 0.08086282947723333,
          "rotation": 0,
          "target": "20-bath-n-closet"
        },
        {
          "yaw": 1.740552203349762,
          "pitch": 0.0009385301616458008,
          "rotation": 8.63937979737193,
          "target": "13-bedrooms-landing"
        },
        {
          "yaw": 1.3921745584483531,
          "pitch": -0.020749740539660166,
          "rotation": 15.707963267948973,
          "target": "17-main-bedroom"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "19-bath-n-closet-entry",
      "name": "Bath-n-Closet Entry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.7914560070903462,
        "pitch": 0.01967740970406595,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.5171997521877056,
          "pitch": 0.018069628852178,
          "rotation": 3.141592653589793,
          "target": "17-main-bedroom"
        },
        {
          "yaw": 2.6934423057274417,
          "pitch": 0.013115108797689956,
          "rotation": 1.5707963267948966,
          "target": "20-bath-n-closet"
        },
        {
          "yaw": 0.7961455230808276,
          "pitch": 0.03333527539087022,
          "rotation": 4.71238898038469,
          "target": "18-main-bed-window"
        },
        {
          "yaw": 1.8542637887167395,
          "pitch": 0.20907266131854918,
          "rotation": 7.0685834705770345,
          "target": "13-bedrooms-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "20-bath-n-closet",
      "name": "Bath-n-Closet",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.5007034089883824,
        "pitch": -0.017366009912013425,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": -2.710656275099801,
          "pitch": -0.07646601360240268,
          "rotation": 1.5707963267948966,
          "target": "19-bath-n-closet-entry"
        },
        {
          "yaw": 0.6723115367049637,
          "pitch": 0.02866080547664751,
          "rotation": 0,
          "target": "21-walk-in-closet"
        },
        {
          "yaw": -2.6956419698556555,
          "pitch": 0.3885113553443702,
          "rotation": 3.141592653589793,
          "target": "21-walk-in-closet"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "21-walk-in-closet",
      "name": "Walk-in Closet",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 2.8619659660306773,
        "pitch": 0.00839770174948029,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 2.8113404614383573,
          "pitch": 0.3578916297125403,
          "rotation": 5.497787143782138,
          "target": "20-bath-n-closet"
        },
        {
          "yaw": 2.811830018930017,
          "pitch": -0.09743385457156961,
          "rotation": 1.5707963267948966,
          "target": "19-bath-n-closet-entry"
        }
      ],
      "infoHotspots": []
    }
  ],
  "name": "Asti Ter 34122",
  "settings": {
    "mouseViewMode": "drag",
    "autorotateEnabled": true,
    "fullscreenButton": true,
    "viewControlButtons": true
  }
};
