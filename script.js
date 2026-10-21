
/* =========================================================
   GREENSPACE EXPLORER
   Parks & Green Spaces in Islamabad–Rawalpindi
   Complete script.js
   ========================================================= */

"use strict";

// -------------------- CONFIGURATION --------------------

const STUDY_AREA = {
    lat: 33.6844,
    lon: 73.0479,
    zoom: 11
};

const PARK_QUERY = `
[out:json][timeout:45];
(
  nwr["leisure"~"^(park|garden|recreation_ground)$"]
  (33.45,72.75,33.85,73.25);
);
out center tags;
`;

const OVERPASS_SERVERS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const OSM_TILE_URL =
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const SATELLITE_TILE_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/" +
    "World_Imagery/MapServer/tile/{z}/{y}/{x}";

// -------------------- ELEMENTS --------------------

const searchInput = document.getElementById("searchInput");
const categorySelect = document.getElementById("categorySelect");
const visibleCount = document.getElementById("visibleCount");
const totalCount = document.getElementById("totalCount");
const resultsList = document.getElementById("resultsList");
const resetButton = document.getElementById("resetButton");
const statusBar = document.getElementById("statusBar");
const refreshButton = document.getElementById("refreshButton");
const locateButton = document.getElementById("locateButton");

// -------------------- MAP SETUP --------------------

const map = L.map("map", {
    zoomControl: true
}).setView(
    [STUDY_AREA.lat, STUDY_AREA.lon],
    STUDY_AREA.zoom
);

const streetLayer = L.tileLayer(OSM_TILE_URL, {
    maxZoom: 19,
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
        'target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
});

const satelliteLayer = L.tileLayer(SATELLITE_TILE_URL, {
    maxZoom: 19,
    attribution:
        'Tiles &copy; <a href="https://www.esri.com/" ' +
        'target="_blank" rel="noopener noreferrer">Esri</a>, ' +
        'Maxar, Earthstar Geographics, and GIS User Community'
});

// Street map is the default layer.
streetLayer.addTo(map);

// Allow users to switch between street and satellite imagery.
L.control.layers(
    {
        "Street Map (OpenStreetMap)": streetLayer,
        "Satellite Imagery (Esri)": satelliteLayer
    },
    {},
    {
        collapsed: true,
        position: "topright"
    }
).addTo(map);

// -------------------- DATA STORAGE --------------------

let allParks = [];
let parkMarkers = [];
let parksLayer = L.layerGroup().addTo(map);
let userLocationMarker = null;

// -------------------- STATUS MESSAGES --------------------

function setStatus(message, isError = false) {
    if (!statusBar) return;

    statusBar.textContent = message;
    statusBar.style.color = isError ? "#b42318" : "";
}

// -------------------- SAFE TEXT --------------------

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (char) {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[char];
    });
}

// -------------------- PARK COORDINATES --------------------

function getParkCoordinates(element) {
    // Ways and relations usually return a center object.
    if (
        element.center &&
        Number.isFinite(Number(element.center.lat)) &&
        Number.isFinite(Number(element.center.lon))
    ) {
        return {
            lat: Number(element.center.lat),
            lon: Number(element.center.lon)
        };
    }

    // Nodes return lat/lon directly.
    if (
        Number.isFinite(Number(element.lat)) &&
        Number.isFinite(Number(element.lon))
    ) {
        return {
            lat: Number(element.lat),
            lon: Number(element.lon)
        };
    }

    return null;
}

// -------------------- OPENSTREETMAP LINK --------------------

function makeOSMUrl(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        return "https://www.openstreetmap.org/";
    }

    return (
        "https://www.openstreetmap.org/" +
        "?mlat=" + encodeURIComponent(latitude) +
        "&mlon=" + encodeURIComponent(longitude) +
        "#map=17/" +
        encodeURIComponent(latitude) +
        "/" +
        encodeURIComponent(longitude)
    );
}

// -------------------- POPUP CONTENT --------------------

function makePopupHTML(park) {
    const osmUrl = makeOSMUrl(park.lat, park.lon);

    return `
        <div style="min-width:230px; max-width:290px;
                    font-family:Arial,sans-serif; line-height:1.5;">

            <h3 style="margin:0 0 12px; color:#176b4d;
                       font-size:19px;">
                ${escapeHTML(park.name)}
            </h3>

            <p style="margin:7px 0;">
                <strong>Category:</strong>
                ${escapeHTML(park.category)}
            </p>

            <p style="margin:7px 0;">
                <strong>Study Area:</strong>
                Islamabad–Rawalpindi
            </p>

            <p style="margin:7px 0;">
                <strong>Coordinates:</strong><br>
                ${park.lat.toFixed(5)}, ${park.lon.toFixed(5)}
            </p>

            <p style="margin:12px 0 0;">
                <a href="${osmUrl}"
                   target="_blank"
                   rel="noopener noreferrer"
                   style="color:#087db5; text-decoration:underline;">
                   View on OpenStreetMap ↗
                </a>
            </p>
        </div>
    `;
}

// -------------------- NORMALIZE API DATA --------------------

function normalizeParks(elements) {
    const uniqueParks = new Map();

    elements.forEach(function (element) {
        const coordinates = getParkCoordinates(element);

        if (!coordinates) return;

        const tags = element.tags || {};

        const name =
            tags.name ||
            tags["name:en"] ||
            tags.official_name ||
            tags["name:ur"] ||
            "Unnamed Green Space";

        const leisure = tags.leisure || "park";

        let category = "Park";

        if (leisure === "garden") {
            category = "Garden";
        } else if (leisure === "recreation_ground") {
            category = "Recreation Ground";
        }

        const park = {
            id: String(element.type) + "/" + String(element.id),
            name: name,
            category: category,
            lat: coordinates.lat,
            lon: coordinates.lon,
            tags: tags
        };

        // Remove duplicate records returned by the API.
        const key =
            park.name.toLowerCase() +
            "|" +
            park.lat.toFixed(5) +
            "|" +
            park.lon.toFixed(5);

        if (!uniqueParks.has(key)) {
            uniqueParks.set(key, park);
        }
    });

    return Array.from(uniqueParks.values()).sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });
}

// -------------------- ADD MARKERS --------------------

function drawMarkers(parks) {
    parksLayer.clearLayers();
    parkMarkers = [];

    parks.forEach(function (park) {
        const marker = L.marker([park.lat, park.lon], {
            title: park.name,
            alt: park.name
        });

        marker.bindPopup(makePopupHTML(park), {
            maxWidth: 320
        });

        marker.bindTooltip(park.name, {
            direction: "top",
            sticky: true
        });

        marker.addTo(parksLayer);

        parkMarkers.push({
            park: park,
            marker: marker
        });
    });
}

// -------------------- RESULTS SIDEBAR --------------------

function renderResults(parks) {
    if (visibleCount) {
        visibleCount.textContent = String(parks.length);
    }

    if (totalCount) {
        totalCount.textContent = String(allParks.length);
    }

    if (!resultsList) return;

    if (parks.length === 0) {
        resultsList.innerHTML = `
            <p style="padding:12px; color:#68756e;">
                No matching green spaces found.
                Try another search.
            </p>
        `;
        return;
    }

    resultsList.innerHTML = "";

    parks.forEach(function (park) {
        const item = document.createElement("div");

        item.className = "park-result";
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.style.cssText =
            "padding:12px; margin:8px 0; border:1px solid #dce7df;" +
            "border-radius:10px; cursor:pointer; background:#fff;";

        item.innerHTML = `
            <div style="font-weight:700; color:#176b4d;">
                ${escapeHTML(park.name)}
            </div>
            <div style="font-size:13px; color:#66766d; margin-top:4px;">
                ${escapeHTML(park.category)}
            </div>
        `;

        function showPark() {
            map.setView([park.lat, park.lon], 16);
            const match = parkMarkers.find(function (entry) {
                return entry.park.id === park.id;
            });

            if (match) {
                match.marker.openPopup();
            }
        }

        item.addEventListener("click", showPark);

        item.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showPark();
            }
        });

        resultsList.appendChild(item);
    });
}

// -------------------- SEARCH AND FILTER --------------------

function applyFilters() {
    const searchTerm = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    const selectedCategory = categorySelect
        ? categorySelect.value
        : "all";

    const filteredParks = allParks.filter(function (park) {
        const matchesSearch =
            park.name.toLowerCase().includes(searchTerm) ||
            park.category.toLowerCase().includes(searchTerm);

        const matchesCategory =
            !selectedCategory ||
            selectedCategory === "all" ||
            selectedCategory === "All" ||
            selectedCategory.toLowerCase() === "parks" ||
            park.category.toLowerCase() === selectedCategory.toLowerCase() ||
            (
                selectedCategory.toLowerCase() === "park" &&
                park.category === "Park"
            );

        return matchesSearch && matchesCategory;
    });

    drawMarkers(filteredParks);
    renderResults(filteredParks);

    if (searchTerm && filteredParks.length === 1) {
        const park = filteredParks[0];

        map.setView([park.lat, park.lon], 16);

        const match = parkMarkers.find(function (entry) {
            return entry.park.id === park.id;
        });

        if (match) {
            match.marker.openPopup();
        }
    } else if (searchTerm && filteredParks.length > 1) {
        const bounds = L.latLngBounds(
            filteredParks.map(function (park) {
                return [park.lat, park.lon];
            })
        );

        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        }
    }
}

// -------------------- FETCH API DATA --------------------

async function fetchFromServer(serverUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
        controller.abort();
    }, 60000);

    try {
        const response = await fetch(serverUrl, {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded;charset=UTF-8",
                "Accept": "application/json"
            },
            body: "data=" + encodeURIComponent(PARK_QUERY),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(
                "Server returned HTTP " + response.status
            );
        }

        const data = await response.json();

        if (!data || !Array.isArray(data.elements)) {
            throw new Error("The API returned an invalid data format.");
        }

        return data.elements;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function loadParks() {
    setStatus("Loading parks from OpenStreetMap...");

    if (resultsList) {
        resultsList.innerHTML = "<p>Loading places...</p>";
    }

    let lastError = null;

    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
        const server = OVERPASS_SERVERS[i];

        setStatus(
            "Loading parks: trying data server " +
            (i + 1) + " of " + OVERPASS_SERVERS.length + "..."
        );

        try {
            const elements = await fetchFromServer(server);

            allParks = normalizeParks(elements);

            if (allParks.length === 0) {
                throw new Error(
                    "The API responded, but no parks were found in this area."
                );
            }

            applyFilters();

            setStatus(
                "Successfully loaded " + allParks.length +
                " green spaces from OpenStreetMap."
            );

            return;
        } catch (error) {
            lastError = error;
            console.warn(
                "Could not load parks from " + server + ":",
                error
            );
        }
    }

    allParks = [];
    drawMarkers([]);
    renderResults([]);

    setStatus(
        "Unable to load live park data. Check your internet connection " +
        "and click Refresh Data to try again. Details: " +
        (lastError ? lastError.message : "Unknown error"),
        true
    );
}

// -------------------- BUTTONS AND INPUTS --------------------

if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
}

if (categorySelect) {
    categorySelect.addEventListener("change", applyFilters);
}

if (resetButton) {
    resetButton.addEventListener("click", function () {
        if (searchInput) searchInput.value = "";

        if (categorySelect) categorySelect.selectedIndex = 0;

        applyFilters();

        map.setView(
            [STUDY_AREA.lat, STUDY_AREA.lon],
            STUDY_AREA.zoom
        );

        setStatus("Search and map view reset.");
    });
}

if (refreshButton) {
    refreshButton.addEventListener("click", loadParks);
}

if (locateButton) {
    locateButton.addEventListener("click", function () {
        if (!navigator.geolocation) {
            setStatus(
                "Your browser does not support location services.",
                true
            );
            return;
        }

        setStatus("Finding your current location...");

        navigator.geolocation.getCurrentPosition(
            function (position) {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                if (userLocationMarker) {
                    map.removeLayer(userLocationMarker);
                }

                userLocationMarker = L.marker([lat, lon])
                    .addTo(map)
                    .bindPopup("Your current location");

                map.setView([lat, lon], 15);
                userLocationMarker.openPopup();

                setStatus("Your current location is shown on the map.");
            },
            function (error) {
                let message = "Could not get your location.";

                if (error.code === 1) {
                    message =
                        "Location permission denied. Allow location access " +
                        "in your browser and try again.";
                } else if (error.code === 2) {
                    message = "Your current location is unavailable.";
                } else if (error.code === 3) {
                    message = "Location request timed out. Try again.";
                }

                setStatus(message, true);
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000
            }
        );
    });
}

// -------------------- TILE ERROR HANDLING --------------------

streetLayer.on("tileerror", function () {
    setStatus(
        "Street map tiles could not load. Check your connection or try Satellite Imagery.",
        true
    );
});

satelliteLayer.on("tileerror", function () {
    setStatus(
        "Satellite tiles could not load. Try Street Map or check your connection.",
        true
    );
});

// -------------------- START APPLICATION --------------------

loadParks();
