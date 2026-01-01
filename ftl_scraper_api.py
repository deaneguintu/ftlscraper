"""
FTL Logistics Enrichment Scraper
FastAPI + Playwright for scraping company logistics data
Includes: Smart navigation, keyword extraction, error handling, batch processing
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
from playwright.async_api import async_playwright
import asyncio
import logging
import re
from urllib.parse import urljoin, urlparse
from datetime import datetime
import httpx

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="FTL Logistics Scraper API")

# ============================================================================
# LOGISTICS KEYWORDS - The Intelligence Behind the Scraper
# ============================================================================

LOGISTICS_KEYWORDS = {
    "equipment": {
        "keywords": ["flatbed", "reefer", "dry van", "step deck", "lowboy", "tanker", 
                    "specialized", "double drop", "conestoga", "power only"],
        "weight": 15
    },
    "lanes": {
        "keywords": ["backhaul", "headhaul", "dedicated lanes", "round trip", "one-way",
                    "regular route", "scheduled service", "weekly runs", "daily service"],
        "weight": 20
    },
    "services": {
        "keywords": ["ltl", "ftl", "full truckload", "less than truckload", "drayage", 
                    "intermodal", "expedited", "white glove", "final mile"],
        "weight": 10
    },
    "patterns": {
        "keywords": ["weekly shipments", "daily routes", "seasonal", "year-round",
                    "monday through friday", "overnight delivery", "same day"],
        "weight": 5
    },
    "industries": {
        "keywords": ["automotive", "food grade", "pharmaceuticals", "construction materials",
                    "retail", "manufacturing", "distribution", "cold chain", "hazmat"],
        "weight": 5
    }
}

# Target pages to check for logistics info
TARGET_PATHS = [
    "/carriers", "/logistics", "/shipping", "/transportation", "/freight",
    "/services/logistics", "/services/shipping", "/services/transportation",
    "/about-us", "/about/services", "/capabilities", "/solutions",
    "/industries", "/warehouse", "/distribution"
]

# Keywords to find in navigation links
NAV_KEYWORDS = [
    "carrier", "logistics", "shipping", "freight", "transportation",
    "supply chain", "warehouse", "distribution", "trucking"
]

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class CompanyInput(BaseModel):
    name: str
    website: str
    address: Optional[str] = ""
    dnb_number: Optional[str] = ""

class ScraperResult(BaseModel):
    url: str
    status: str
    primary_lanes: str
    product_type: str
    equipment_types: str
    shipping_frequency: str
    confidence_score: int
    pages_checked: List[str]
    error: Optional[str] = None
    timestamp: str

# ============================================================================
# DEAD LINK CHECKER
# ============================================================================

async def check_if_alive(url: str) -> Dict:
    """Quick check if website is alive before scraping"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.head(url, follow_redirects=True)
            
            if response.status_code == 404:
                return {"alive": False, "status": "Inactive", "error": "404 Not Found"}
            elif response.status_code == 403:
                return {"alive": False, "status": "Blocked", "error": "403 Forbidden"}
            elif response.status_code >= 500:
                return {"alive": False, "status": "Server Error", "error": f"{response.status_code} Server Error"}
            elif response.status_code >= 200 and response.status_code < 400:
                return {"alive": True, "status": "Active", "error": None}
            else:
                return {"alive": True, "status": "Unknown", "error": f"Status {response.status_code}"}
                
    except httpx.ConnectError:
        return {"alive": False, "status": "Inactive", "error": "DNS/Connection Error"}
    except httpx.TimeoutException:
        return {"alive": False, "status": "Timeout", "error": "Connection Timeout"}
    except Exception as e:
        return {"alive": False, "status": "Error", "error": str(e)}

# ============================================================================
# KEYWORD EXTRACTION
# ============================================================================

def extract_logistics_keywords(content: str) -> Dict:
    """Extract logistics-specific keywords with scoring"""
    
    content_lower = content.lower()
    results = {
        "equipment_types": [],
        "lanes": [],
        "services": [],
        "patterns": [],
        "industries": [],
        "confidence_score": 0
    }
    
    # Search for keywords in each category
    for category, data in LOGISTICS_KEYWORDS.items():
        for keyword in data["keywords"]:
            if keyword in content_lower:
                # Add to results
                if keyword not in results.get(category, []):
                    results[category].append(keyword.title())
                
                # Increase confidence score
                results["confidence_score"] += data["weight"]
    
    return results

def extract_shipping_lanes(content: str) -> List[str]:
    """Extract shipping lanes from text (e.g., CA to TX, California-Texas)"""
    
    lanes = []
    
    # Pattern 1: State abbreviations (CA to TX, CA-TX, CA/TX)
    pattern1 = r'\b([A-Z]{2})\s*(?:to|→|-|/)\s*([A-Z]{2})\b'
    matches1 = re.findall(pattern1, content)
    for match in matches1:
        lane = f"{match[0]} to {match[1]}"
        if lane not in lanes:
            lanes.append(lane)
    
    # Pattern 2: Full state names (California to Texas)
    us_states = [
        "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
        "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
        "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
        "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
        "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
        "New Hampshire", "New Jersey", "New Mexico", "New York",
        "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
        "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
        "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
        "West Virginia", "Wisconsin", "Wyoming"
    ]
    
    for i, state1 in enumerate(us_states):
        for state2 in us_states[i+1:]:
            pattern = f"{state1}\\s*(?:to|→|-|/)\\s*{state2}"
            if re.search(pattern, content, re.IGNORECASE):
                lane = f"{state1} to {state2}"
                if lane not in lanes:
                    lanes.append(lane)
    
    return lanes[:5]  # Limit to top 5 lanes

# ============================================================================
# SMART NAVIGATION
# ============================================================================

async def find_logistics_pages(base_url: str, page) -> List[Dict]:
    """Intelligently find pages with logistics information"""
    
    found_pages = []
    checked_urls = set()
    
    try:
        # Step 1: Check homepage
        logger.info(f"Checking homepage: {base_url}")
        await page.goto(base_url, timeout=15000, wait_until="networkidle")
        
        content = await page.content()
        text = await page.text_content('body')
        
        if has_logistics_content(text):
            found_pages.append({
                "url": base_url,
                "type": "homepage",
                "content": text
            })
            logger.info(f"✓ Homepage has logistics content")
        
        checked_urls.add(base_url)
        
        # Step 2: Try known logistics paths
        for path in TARGET_PATHS:
            try:
                url = urljoin(base_url, path)
                if url in checked_urls:
                    continue
                
                logger.info(f"Trying path: {path}")
                response = await page.goto(url, timeout=10000, wait_until="domcontentloaded")
                
                if response and response.status == 200:
                    text = await page.text_content('body')
                    
                    if has_logistics_content(text):
                        found_pages.append({
                            "url": url,
                            "type": "direct_path",
                            "content": text
                        })
                        logger.info(f"✓ Found logistics content at: {path}")
                        checked_urls.add(url)
                        
            except Exception as e:
                logger.debug(f"Path {path} failed: {e}")
                continue
        
        # Step 3: Search navigation links for logistics keywords
        logger.info("Searching navigation links...")
        await page.goto(base_url, timeout=10000)
        
        links = await page.query_selector_all('a[href]')
        nav_links_checked = 0
        
        for link in links[:30]:  # Limit to avoid slowdown
            try:
                href = await link.get_attribute('href')
                link_text = await link.text_content()
                
                if not href or not link_text:
                    continue
                
                # Check if link text contains logistics keywords
                if any(kw in link_text.lower() for kw in NAV_KEYWORDS):
                    full_url = urljoin(base_url, href)
                    
                    # Skip external links, already checked URLs, and anchors
                    if urlparse(full_url).netloc != urlparse(base_url).netloc:
                        continue
                    if full_url in checked_urls:
                        continue
                    if '#' in full_url:
                        full_url = full_url.split('#')[0]
                    
                    logger.info(f"Checking nav link: {link_text} → {full_url}")
                    
                    try:
                        await page.goto(full_url, timeout=10000, wait_until="domcontentloaded")
                        text = await page.text_content('body')
                        
                        if has_logistics_content(text):
                            found_pages.append({
                                "url": full_url,
                                "type": "nav_link",
                                "content": text
                            })
                            logger.info(f"✓ Found logistics content via nav link")
                            checked_urls.add(full_url)
                            nav_links_checked += 1
                            
                            if nav_links_checked >= 5:  # Stop after finding 5 good pages
                                break
                    except:
                        continue
                        
            except Exception as e:
                logger.debug(f"Nav link check failed: {e}")
                continue
        
        return found_pages
        
    except Exception as e:
        logger.error(f"Smart navigation failed: {e}")
        return found_pages

def has_logistics_content(text: str, threshold: int = 3) -> bool:
    """Check if text has enough logistics keywords"""
    
    if not text:
        return False
    
    text_lower = text.lower()
    keyword_count = 0
    
    for category_data in LOGISTICS_KEYWORDS.values():
        for keyword in category_data["keywords"]:
            if keyword in text_lower:
                keyword_count += 1
    
    return keyword_count >= threshold

# ============================================================================
# MAIN SCRAPER
# ============================================================================

async def scrape_company(company: CompanyInput) -> ScraperResult:
    """Main scraping function with comprehensive error handling"""
    
    url = company.website
    if not url.startswith('http'):
        url = f"https://{url}"
    
    result = ScraperResult(
        url=url,
        status="Unknown",
        primary_lanes="",
        product_type="",
        equipment_types="",
        shipping_frequency="",
        confidence_score=0,
        pages_checked=[],
        timestamp=datetime.now().isoformat()
    )
    
    # Step 1: Check if website is alive
    logger.info(f"Checking if {url} is alive...")
    alive_check = await check_if_alive(url)
    
    if not alive_check["alive"]:
        result.status = alive_check["status"]
        result.error = alive_check["error"]
        logger.warning(f"Website dead: {alive_check['error']}")
        return result
    
    # Step 2: Scrape with Playwright
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox'
                ]
            )
            
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                locale='en-US',
                extra_http_headers={
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Connection': 'keep-alive'
                }
            )
            
            page = await context.new_page()
            
            # Remove webdriver detection
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            """)
            
            # Step 3: Smart navigation to find logistics pages
            logger.info(f"Starting smart navigation for {company.name}")
            found_pages = await find_logistics_pages(url, page)
            
            if not found_pages:
                result.status = "No Logistics Content"
                result.error = "No pages with logistics keywords found"
                logger.warning(f"No logistics content found for {company.name}")
                await browser.close()
                return result
            
            # Step 4: Extract data from all found pages
            all_keywords = {
                "equipment_types": [],
                "lanes": [],
                "services": [],
                "patterns": [],
                "industries": [],
                "confidence_score": 0
            }
            
            all_lanes = []
            
            for page_data in found_pages:
                result.pages_checked.append(page_data["url"])
                
                # Extract keywords
                keywords = extract_logistics_keywords(page_data["content"])
                
                # Merge results
                for key in ["equipment_types", "lanes", "services", "patterns", "industries"]:
                    all_keywords[key].extend(keywords.get(key, []))
                
                all_keywords["confidence_score"] += keywords["confidence_score"]
                
                # Extract shipping lanes
                lanes = extract_shipping_lanes(page_data["content"])
                all_lanes.extend(lanes)
            
            # Step 5: Format results
            result.equipment_types = ", ".join(list(set(all_keywords["equipment_types"]))[:3])
            result.primary_lanes = ", ".join(list(set(all_lanes))[:3])
            result.product_type = ", ".join(list(set(all_keywords["industries"]))[:2])
            result.shipping_frequency = ", ".join(list(set(all_keywords["patterns"]))[:2])
            result.confidence_score = all_keywords["confidence_score"]
            
            # Determine status based on confidence
            if result.confidence_score >= 50:
                result.status = "Complete - High Confidence"
            elif result.confidence_score >= 20:
                result.status = "Complete - Medium Confidence"
            else:
                result.status = "Complete - Low Confidence"
            
            logger.info(f"✓ Scraped {company.name} - Score: {result.confidence_score}")
            
            await browser.close()
            return result
            
    except asyncio.TimeoutError:
        result.status = "Timeout"
        result.error = "Page load timeout"
        logger.error(f"Timeout scraping {url}")
        return result
        
    except Exception as e:
        result.status = "Error"
        result.error = str(e)
        logger.error(f"Error scraping {url}: {e}")
        return result

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
def root():
    return {
        "name": "FTL Logistics Enrichment API",
        "version": "1.0",
        "status": "running",
        "endpoints": {
            "/scrape": "POST - Scrape single company",
            "/scrape_batch": "POST - Scrape multiple companies",
            "/health": "GET - Health check"
        }
    }

@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.post("/scrape", response_model=ScraperResult)
async def scrape_single(company: CompanyInput):
    """Scrape a single company"""
    logger.info(f"Received scrape request for: {company.name}")
    result = await scrape_company(company)
    return result

@app.post("/scrape_batch")
async def scrape_batch(companies: List[CompanyInput]):
    """Scrape multiple companies with rate limiting"""
    logger.info(f"Received batch request for {len(companies)} companies")
    
    results = []
    
    # Process in smaller groups to avoid overwhelming
    batch_size = 3
    for i in range(0, len(companies), batch_size):
        batch = companies[i:i+batch_size]
        
        # Scrape concurrently within batch
        tasks = [scrape_company(company) for company in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Add results
        for idx, res in enumerate(batch_results):
            if isinstance(res, Exception):
                logger.error(f"Error in batch: {res}")
                results.append({
                    "url": batch[idx].website,
                    "status": "Error",
                    "error": str(res)
                })
            else:
                results.append(res)
        
        # Wait between batches
        if i + batch_size < len(companies):
            logger.info(f"Waiting 2 seconds before next batch...")
            await asyncio.sleep(2)
    
    logger.info(f"Batch complete: {len(results)} companies processed")
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
